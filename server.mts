import { WebSocketServer, WebSocket } from 'ws';
import * as common from './common.mjs';
import { Player, Balloon } from './common.mjs';

namespace Stats {
    const AVERAGE_CAPACITY = 30;

    export interface Counter {
        kind: 'counter',
        counter: number,
        description: string,
    }

    export interface Average {
        kind: 'average';
        samples: Array<number>;
        description: string;
        pushSample(sample: number): void;
    }

    export interface Timer {
        kind: 'timer',
        startedAt: number,
        description: string,
    }

    type Stat = Counter | Average | Timer;
    type Stats = { [key: string]: Stat }
    const stats: Stats = {}

    function average(samples: Array<number>): number {
        return samples.reduce((a, b) => a + b, 0) / samples.length;
    }

    function pluralNumber(num: number, singular: string, plural: string): string {
        return num === 1 ? singular : plural;
    }

    function displayTimeInterval(diffMs: number): string {
        const result = [];
        const diffSecs = Math.floor(diffMs / 1000);

        const days = Math.floor(diffSecs / 60 / 60 / 24);
        if (days > 0) result.push(`${days} ${pluralNumber(days, 'day', 'days')}`);

        const hours = Math.floor(diffSecs / 60 / 60 % 24);
        if (hours > 0) result.push(`${hours} ${pluralNumber(hours, 'hour', 'hours')}`);

        const mins = Math.floor(diffSecs / 60 % 60);
        if (mins > 0) result.push(`${mins} ${pluralNumber(mins, 'min', 'mins')}`);

        const secs = Math.floor(diffSecs % 60);
        if (secs > 0) result.push(`${secs} ${pluralNumber(secs, 'sec', 'secs')}`);

        return result.length ? '0 secs' : result.join(' ');
    }

    function getStat(stat: Stat): string {
        switch (stat.kind) {
            case 'counter': return stat.counter.toString();
            case 'average': return average(stat.samples).toString();
            case 'timer': return displayTimeInterval(Date.now() - stat.startedAt);
        }
    }

    function registerCounter(name: string, description: string): Counter {
        const stat: Counter = {
            kind: 'counter',
            counter: 0,
            description,
        }
        stats[name] = stat;
        return stat;
    }

    function pushSample(this: Average, sample: number) {
        while (this.samples.length > AVERAGE_CAPACITY) this.samples.shift();
        this.samples.push();
    }

    function registerAverage(name: string, description: string): Average {
        const stat: Average = {
            kind: 'average',
            samples: [],
            description,
            pushSample,
        }
        stats[name] = stat;
        return stat;
    }

    function registerTimer(name: string, description: string): Timer {
        const stat: Timer = {
            kind: 'timer',
            startedAt: 0,
            description,
        }
        stats[name] = stat;
        return stat;
    }

    export function print() {
        console.log("Stats:");
        for (let key in stats) {
            console.log(`   ${stats[key].description}`, getStat(stats[key]));
        }
    }

    export const uptime = registerTimer("uptime", "Uptime");
    export const ticksCount = registerCounter("ticksCount", "Ticks count");
    export const tickTimes = registerAverage("tickTimes", "Average time to process a tick");
    export const messagesSent = registerCounter("messagesSent", "Total messages sent");
    export const messagesReceived = registerCounter("messagesReceived", "Total messages received");
    export const tickMessagesSent = registerAverage("tickMessagesSent", "Average messages sent per tick");
    export const tickMessagesReceived = registerAverage("tickMessagesReceived", "Average messages received per tick");
    export const bytesSent = registerCounter("bytesSent", "Total bytes sent");
    export const bytesReceived = registerCounter("bytesReceived", "Total bytes received");
    export const tickByteSent = registerAverage("tickByteSent", "Average bytes sent per tick");
    export const tickByteReceived = registerAverage("tickByteReceived", "Average bytes received per tick");
    export const playersCurrently = registerCounter("playersCurrently", "Currently players");
    export const playersJoined = registerCounter("playersJoined", "Total players joined");
    export const playersLeft = registerCounter("playersLeft", "Total players left");
    export const bsMessages = registerCounter("bsMessages", "Total bs messages");
    export const playersRejected = registerCounter("playersRejected", "Total players rejected");
}

const SERVER_FPS = 60;
const SERVER_LIMIT = 10;

const BALLOON_LIMIT = 10;

interface PlayerOnServer extends Player {
    ws: WebSocket,
}

function filterPlayersOnServerMap(map: Map<number, PlayerOnServer>, predicate: (value: PlayerOnServer) => boolean): Map<number, PlayerOnServer> {
    const result = new Map<number, PlayerOnServer>();

    map.forEach((player, id) => {
        if (predicate(player)) result.set(id, player);
    });

    return result;
}

const players = new Map<number, PlayerOnServer>();
const balloons = new Map<number, Balloon>();

let idCounter = 0;

let balloonCounter = 0;

let bytesReceivedWithinTick = 0;
let messagesReceivedWithinTick = 0;

const wss = new WebSocketServer({
    port: common.SERVER_PORT
});

const joinedIds = new Set<number>;
const leftIds = new Set<number>;

const pingIds = new Map<number, number>();

const requestUsernameIds = new Map<number, Uint8Array>();
const setUsernameIds = new Set<number>;

const createdBalloonIds = new Set<number>;
const poppedBalloonIds = new Map<number, number>();

const updatedScorePlayerIds = new Set<number>;

wss.on('connection', function connection(ws) {
    ws.binaryType = 'arraybuffer';

    if (players.size >= SERVER_LIMIT) {
        Stats.playersRejected.counter += 1;
        ws.close();
        return;
    }

    const id = idCounter++;

    const player = {
        ws,
        id,
        username: undefined,
        score: 0
    }

    players.set(id, player);

    joinedIds.add(id);

    Stats.playersJoined.counter += 1;
    Stats.playersCurrently.counter += 1;

    ws.addEventListener('message', (event) => {
        Stats.messagesReceived.counter += 1;
        messagesReceivedWithinTick += 1;

        if (!(event.data instanceof ArrayBuffer)) {
            Stats.bsMessages.counter += 1;
            ws.close();
            return;
        }

        const view = new DataView(event.data);

        Stats.bytesReceived.counter += view.byteLength;
        bytesReceivedWithinTick += view.byteLength;

        if (common.SetUsernameStruct.verify(view)) {
            const playerId = common.SetUsernameStruct.id.read(view);
            const username = common.SetUsernameStruct.value.read(view);

            requestUsernameIds.set(playerId, username);

        } else if (common.PingStruct.verify(view)) {
            pingIds.set(id, common.PingStruct.timestamp.read(view));

        } else if (common.BalloonPopStruct.verify(view)) {
            const balloonId = common.BalloonPopStruct.id.read(view);
            const balloon = balloons.get(balloonId);

            if (balloon !== undefined) {
                balloons.delete(id);
                poppedBalloonIds.set(balloonId, common.BalloonPopStruct.playerId.read(view));
                balloonCounter--;
            } else {
                console.log("balloon no longer exists");
            }

        } else {
            Stats.bsMessages.counter += 1;
            ws.close();
            return;
        }
    });

    ws.on("close", () => {
        players.delete(id);

        Stats.playersLeft.counter += 1;
        Stats.playersCurrently.counter -= 1;

        if (!joinedIds.delete(id)) leftIds.add(id);
    });
});

let previousTimestamp = performance.now();

function tick() {
    const timestamp = performance.now();
    const deltaTime = (timestamp - previousTimestamp) / 1000;

    previousTimestamp = timestamp;

    let messageSentCounter = 0;
    let bytesSentCounter = 0;

    if (poppedBalloonIds.size > 0) {
        // todo: refactor to remove the nested loop
        poppedBalloonIds.forEach((playerId, balloonId) => {
            const player = players.get(playerId);
            if (player !== undefined) {
                player.score += 5;
                updatedScorePlayerIds.add(playerId);
            }

            const view = new DataView(new ArrayBuffer(common.BalloonPopStruct.size));

            common.BalloonPopStruct.kind.write(view, common.MessageKind.BalloonPop);
            common.BalloonPopStruct.timestamp.write(view, performance.now());
            common.BalloonPopStruct.id.write(view, balloonId);

            players.forEach((player) => {
                if (player.username !== undefined) {
                    player.ws.send(view);

                    bytesSentCounter += view.byteLength;
                    messageSentCounter += 1;
                }
            });

        });
    }

    // todo: sendout player score updates

    if (requestUsernameIds.size > 0) {
        requestUsernameIds.forEach((username, playerId) => {
            const valid = !Array.from(players.values()).some(player => player.username === username);

            const player = players.get(playerId);

            if (player !== undefined) {

                if (valid) player.username = username;

                const view = new DataView(new ArrayBuffer(common.ValidUsernameStruct.size));

                common.ValidUsernameStruct.kind.write(view, common.MessageKind.ValidUsername);
                common.ValidUsernameStruct.value.write(view, username);
                common.ValidUsernameStruct.valid.write(view, valid ? 1 : 0);

                player.ws.send(view);

                if (valid) setUsernameIds.add(playerId);
            }
        });
    }

    if (setUsernameIds.size > 0) {
        // notify all newly set username players of the existing players with username
        {
            const existingPlayersWithUsernames = filterPlayersOnServerMap(
                players,
                (player) => player.username !== undefined && !setUsernameIds.has(player.id)
            );

            const count = existingPlayersWithUsernames.size;
            const buffer = new ArrayBuffer(common.PlayersHeaderStruct.size + count * common.PlayerStruct.size);
            const headerView = new DataView(buffer, 0, common.PlayersHeaderStruct.size);
            common.PlayersHeaderStruct.kind.write(headerView, common.MessageKind.Players);

            let index = 0;
            existingPlayersWithUsernames.forEach((player) => {
                if (player.username !== undefined) { // this should not happen
                    const playerView = new DataView(buffer, common.PlayersHeaderStruct.size + index * common.PlayerStruct.size);
                    common.PlayerStruct.id.write(playerView, player.id);
                    common.PlayerStruct.username.write(playerView, player.username);
                    common.PlayerStruct.score.write(playerView, player.score);
                    index += 1;
                }
            });

            // todo: notify new players of existing balloons

            setUsernameIds.forEach((playerId) => {
                const player = players.get(playerId);
                if (player !== undefined) { // this should not happen
                    player.ws.send(buffer);
                    bytesSentCounter += buffer.byteLength;
                    messageSentCounter += 1;
                }
            });
        }

        // notify existing players with username of those who have got a username set
        {
            const count = setUsernameIds.size;
            const buffer = new ArrayBuffer(common.PlayersJoinedHeaderStruct.size + count * common.PlayerUsernameStruct.size);
            const headerView = new DataView(buffer, 0, common.PlayersJoinedHeaderStruct.size);
            common.PlayersJoinedHeaderStruct.kind.write(headerView, common.MessageKind.PlayersJoined);

            let index = 0;
            setUsernameIds.forEach((playerId) => {
                const player = players.get(playerId);

                if (player !== undefined && player.username !== undefined) { // this should not happen
                    const playerView = new DataView(buffer, common.PlayersJoinedHeaderStruct.size + index * common.PlayerUsernameStruct.size);

                    common.PlayerUsernameStruct.id.write(playerView, player.id);
                    common.PlayerUsernameStruct.username.write(playerView, player.username);

                    index += 1;
                }
            });

            players.forEach((player) => {
                if (player.username && !setUsernameIds.has(player.id)) {
                    player.ws.send(buffer);
                    bytesSentCounter += buffer.byteLength;
                    messageSentCounter += 1;
                }
            });
        }
    }

    if (updatedScorePlayerIds.size > 0) {
        const count = updatedScorePlayerIds.size;
        const buffer = new ArrayBuffer(common.PlayersScoresHeaderStruct.size + count * common.PlayerScoreStruct.size);
        const headerView = new DataView(buffer, 0, common.PlayersScoresHeaderStruct.size);
        common.PlayersScoresHeaderStruct.kind.write(headerView, common.MessageKind.PlayersScores);

        let index = 0;
        updatedScorePlayerIds.forEach((playerId) => {
            const player = players.get(playerId);

            if (player !== undefined && player.username !== undefined) { // this should not happen
                const playerView = new DataView(buffer, common.PlayersScoresHeaderStruct.size + index * common.PlayerScoreStruct.size);

                common.PlayerScoreStruct.id.write(playerView, player.id);
                common.PlayerScoreStruct.score.write(playerView, player.score);

                index += 1;
            }

            players.forEach((player) => {
                if (player.username) {
                    player.ws.send(buffer);
                    bytesSentCounter += buffer.byteLength;
                    messageSentCounter += 1;
                }
            });
        });
    }


    if (joinedIds.size > 0) {
        {
            joinedIds.forEach((joinedId) => {
                const joinedPlayer = players.get(joinedId);

                if (joinedPlayer !== undefined) {
                    const view = new DataView(new ArrayBuffer(common.HelloStruct.size));

                    common.HelloStruct.kind.write(view, common.MessageKind.Hello);
                    common.HelloStruct.id.write(view, joinedId);

                    joinedPlayer.ws.send(view);

                    bytesSentCounter += view.byteLength;
                    messageSentCounter += 1;
                }
            });
        }
    }

    pingIds.forEach((timestamp, id) => {
        const player = players.get(id);
        if (player !== undefined) {
            const view = new DataView(new ArrayBuffer(common.PongStruct.size));

            common.PongStruct.kind.write(view, common.MessageKind.Pong);
            common.PongStruct.timestamp.write(view, timestamp);

            player.ws.send(view);

            bytesSentCounter += 1;
            messageSentCounter += 1;
        }
    });

    const playersWithUsername = filterPlayersOnServerMap(players, (player) => player.username !== undefined);

    if (playersWithUsername.size && balloonCounter < BALLOON_LIMIT && Stats.ticksCount.counter % (SERVER_FPS / 2) === 0) {
        const dynamicProbability = Math.exp(-balloonCounter / (BALLOON_LIMIT / 4));
        if (Math.random() < dynamicProbability) {

            const id = idCounter++;
            const x = Math.random() * (common.WORLD_WIDTH - common.BALLOON_SIZE);
            const y = Math.random() * (common.WORLD_HEIGHT - common.BALLOON_SIZE);
            const hue = Math.floor(Math.random() * 360);

            const balloon = {
                id,
                x,
                y,
                hue,
                timestamp
            }

            balloons.set(id, balloon);

            createdBalloonIds.add(id);

            balloonCounter++;
        }
    }

    createdBalloonIds.forEach((createdBallonId) => {
        const createdBalloon = balloons.get(createdBallonId);

        if (createdBalloon !== undefined) {
            // unsure why this would not be the case tbh but silencing may be undefined

            const view = new DataView(new ArrayBuffer(common.BalloonCreatedStruct.size));

            common.BalloonCreatedStruct.kind.write(view, common.MessageKind.BalloonCreated);

            common.BalloonCreatedStruct.id.write(view, createdBalloon.id);
            common.BalloonCreatedStruct.x.write(view, createdBalloon.x);
            common.BalloonCreatedStruct.y.write(view, createdBalloon.y);
            common.BalloonCreatedStruct.hue.write(view, createdBalloon.hue);
            common.BalloonCreatedStruct.timestamp.write(view, createdBalloon.timestamp);

            // this nested for each is fine as the outer for each is guarenteed to be singular at this point
            // update whenever the outer becomes multiple
            players.forEach((player) => {
                if (player.username !== undefined) {
                    player.ws.send(view);

                    bytesSentCounter += view.byteLength;
                    messageSentCounter += 1;
                }
            });
        }
    });

    const tickTime = performance.now() - timestamp;

    Stats.ticksCount.counter += 1;
    Stats.tickTimes.pushSample(tickTime / 1000);
    Stats.messagesSent.counter += messageSentCounter;
    Stats.tickMessagesSent.pushSample(messageSentCounter);
    Stats.tickMessagesReceived.pushSample(messagesReceivedWithinTick);
    Stats.bytesSent.counter += bytesSentCounter;
    Stats.tickByteSent.pushSample(bytesSentCounter);
    Stats.tickByteReceived.pushSample(bytesReceivedWithinTick);

    createdBalloonIds.clear();
    poppedBalloonIds.clear();

    updatedScorePlayerIds.clear();

    joinedIds.clear();
    leftIds.clear();

    pingIds.clear();
    requestUsernameIds.clear();
    setUsernameIds.clear();

    bytesReceivedWithinTick = 0;
    messagesReceivedWithinTick = 0;

    if (Stats.ticksCount.counter % SERVER_FPS === 0) {
        // Stats.print();
    }

    setTimeout(tick, Math.max(0, 1000 / SERVER_FPS - tickTime));
}

setTimeout(tick, 1000 / SERVER_FPS);
console.log(`Listening to ws://0.0.0.0:${common.SERVER_PORT}`);
