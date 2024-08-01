import { WebSocketServer, WebSocket } from 'ws';
import * as common from './common.mjs';
import { Player } from './common.mjs';

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

interface PlayerOnServer extends Player {
    ws: WebSocket,
}

const players = new Map<number, PlayerOnServer>();

let idCounter = 0;
let bytesReceivedWithinTick = 0;
let messagesReceivedWithinTick = 0;

const wss = new WebSocketServer({
    port: common.SERVER_PORT
});

const joinedIds = new Set<number>;
const leftIds = new Set<number>;
const pingIds = new Map<number, number>();

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
        id
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

        if (common.PingStruct.verify(view)) {
            pingIds.set(id, common.PingStruct.timestamp.read(view));
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

    const tickTime = performance.now() - timestamp;

    Stats.ticksCount.counter += 1;
    Stats.tickTimes.pushSample(tickTime / 1000);
    Stats.messagesSent.counter += messageSentCounter;
    Stats.tickMessagesSent.pushSample(messageSentCounter);
    Stats.tickMessagesReceived.pushSample(messagesReceivedWithinTick);
    Stats.bytesSent.counter += bytesSentCounter;
    Stats.tickByteSent.pushSample(bytesSentCounter);
    Stats.tickByteReceived.pushSample(bytesReceivedWithinTick);

    joinedIds.clear();
    leftIds.clear();
    pingIds.clear();

    bytesReceivedWithinTick = 0;
    messagesReceivedWithinTick = 0;

    if (Stats.ticksCount.counter % SERVER_FPS === 0) {
        // Stats.print();
    }

    setTimeout(tick, Math.max(0, 1000 / SERVER_FPS - tickTime));
}

setTimeout(tick, 1000 / SERVER_FPS);
console.log(`Listening to ws://0.0.0.0:${common.SERVER_PORT}`);
