import * as common from './common.mjs';
import type { Player, Balloon } from './common.mjs';


(async () => {
    const infoCanvas = document.getElementById('info') as HTMLCanvasElement | null;
    const gameCanvas = document.getElementById('game') as HTMLCanvasElement | null;
    const usernameInput = document.getElementById('username') as HTMLInputElement | null;

    if (infoCanvas === null) throw new Error('No element with id `info`');
    if (gameCanvas === null) throw new Error('No element with id `game`');
    if (usernameInput === null) throw new Error('No element with id `username`');

    const focusUsernameInput = () => usernameInput.focus();
    const hideUsernameInput = () => {
        window.removeEventListener("click", focusUsernameInput);
        usernameInput.hidden = true;
    }

    infoCanvas.width = common.WORLD_WIDTH;
    infoCanvas.height = common.WORLD_HEIGHT + 2 * common.PADDING;

    gameCanvas.width = common.WORLD_WIDTH;
    gameCanvas.height = common.WORLD_HEIGHT;

    const infoCtx = infoCanvas.getContext("2d");
    const gameCtx = gameCanvas.getContext("2d");

    if (infoCtx === null) throw new Error('2d canvas is not supported');
    if (gameCtx === null) throw new Error('2d canvas is not supported');

    let ws: WebSocket | undefined = new WebSocket(`ws://${window.location.hostname}:${common.SERVER_PORT}`);
    let me: Player | undefined = undefined;
    const players = new Map<number, Player>();

    const balloons = new Map<number, Balloon>();
    const balloonPaths = new Map<number, Path2D>();

    let ping = 0;

    ws.binaryType = 'arraybuffer';

    ws.addEventListener("open", (event) => {
        console.log("WEBSOCKET OPEN", event);
        window.addEventListener("click", focusUsernameInput);
        usernameInput.removeAttribute('hidden');
        focusUsernameInput();
    });

    ws.addEventListener("close", (event) => {
        console.log("WEBSOCKET CLOSE", event);
        if (!usernameInput.hidden) hideUsernameInput();
        ws = undefined;
    });

    ws.addEventListener("error", (event) => {
        console.log("WEBSOCKET ERROR", event);
    });

    ws.addEventListener("message", (event) => {
        if (!(event.data instanceof ArrayBuffer)) {
            console.error("Received bs from server. Expected binary data", event);
            ws?.close();
        }

        const view = new DataView(event.data);

        if (me === undefined) {
            if (common.HelloStruct.verify(view)) {
                me = {
                    id: common.HelloStruct.id.read(view),
                    username: undefined,
                    score: 0
                }
                players.set(me.id, me);

            } else {
                console.error("Received bs message from server. Incorrect `Hello` message.", view);
                ws?.close();
            }
        } else if (me.username === undefined) {
            if (common.ValidUsernameStruct.verify(view)) {
                const username = common.ValidUsernameStruct.value.read(view);
                const valid = common.ValidUsernameStruct.valid.read(view);

                if (valid) {
                    me.username = username;
                    hideUsernameInput();
                }

            } else {
                console.error("Received bs message from server.", view);
                ws?.close();
            }

        } else {
            if (common.PlayersHeaderStruct.verify(view)) {
                const count = common.PlayersHeaderStruct.count(view);
                for (let i = 0; i < count; i++) {
                    const playerView = new DataView(event.data, common.PlayersHeaderStruct.size + i * common.PlayerStruct.size, common.PlayerStruct.size);

                    const id = common.PlayerStruct.id.read(playerView);
                    const score = common.PlayerStruct.score.read(playerView);
                    const username = common.PlayerStruct.username.read(playerView);

                    const player = players.get(id);

                    if (player === undefined) {
                        players.set(id, {
                            id,
                            username,
                            score
                        });
                    } else {
                        player.username = username;
                        player.score = score;
                    }
                }

            } else if (common.PongStruct.verify(view)) {
                ping = performance.now() - common.PongStruct.timestamp.read(view);

            } else if (common.BalloonCreatedStruct.verify(view)) {
                const id = common.BalloonCreatedStruct.id.read(view);

                balloons.set(id, {
                    id,
                    x: common.BalloonCreatedStruct.x.read(view),
                    y: common.BalloonCreatedStruct.y.read(view),
                    hue: common.BalloonCreatedStruct.hue.read(view),
                    timestamp: common.BalloonCreatedStruct.timestamp.read(view)
                });

            } else if (common.BalloonPopStruct.verify(view)) {
                const id = common.BalloonPopStruct.id.read(view);

                balloons.delete(id);

            } else {
                console.error("Received bs message from server.", view);
                ws?.close();
            }
        }
    });

    const PING_COOLDOWN = 60;
    let previousTimestamp = 0;
    let pingCooldown = PING_COOLDOWN;

    const frame = (timestamp: number) => {
        const deltaTime = (timestamp - previousTimestamp) / 1000;
        previousTimestamp = timestamp;

        infoCtx.fillStyle = '#303030';
        infoCtx.fillRect(0, 0, infoCtx.canvas.width, infoCtx.canvas.height);

        gameCtx.fillStyle = '#202020';
        gameCtx.fillRect(0, 0, gameCtx.canvas.width, gameCtx.canvas.height);

        if (ws === undefined) {
            const label = "Disconnected";
            const size = gameCtx.measureText(label);
            gameCtx.font = "48px bold";
            gameCtx.fillStyle = "white";
            gameCtx.fillText(label, (gameCtx.canvas.width - size.width) / 2, gameCtx.canvas.height / 2);

        } else if (me?.username === undefined) {

        } else {
            balloons.forEach((balloon) => {
                const balloonPath = new Path2D();
                balloonPath.rect(balloon.x, balloon.y, common.BALLOON_SIZE, common.BALLOON_SIZE);

                balloonPaths.set(balloon.id, balloonPath);

                gameCtx.fillStyle = `hsl(${balloon.hue} 70% 40%)`;
                gameCtx.fill(balloonPath);
            });

            infoCtx.font = `${Math.floor(common.PADDING * 0.65)}px bold`;
            infoCtx.fillStyle = "white";
            infoCtx.textBaseline = 'middle';

            infoCtx.fillText(`Ping: ${ping.toFixed(2)}ms`, common.PADDING, common.PADDING / 2);

            pingCooldown -= 1;

            if (pingCooldown <= 0) {
                const view = new DataView(new ArrayBuffer(common.PingStruct.size));
                common.PingStruct.kind.write(view, common.MessageKind.Ping);
                common.PingStruct.timestamp.write(view, performance.now());
                ws.send(view);

                pingCooldown = PING_COOLDOWN;
            }
        }
        window.requestAnimationFrame(frame);
    };

    window.requestAnimationFrame((timestamp) => {
        previousTimestamp = timestamp;
        window.requestAnimationFrame(frame);
    });

    gameCanvas.addEventListener("click", function (event) {
        balloonPaths.forEach((balloonPath, id) => {
            if (ws !== undefined && me !== undefined && gameCtx.isPointInPath(balloonPath, event.offsetX, event.offsetY)) {
                const view = new DataView(new ArrayBuffer(common.BalloonPopStruct.size));

                common.BalloonPopStruct.kind.write(view, common.MessageKind.BalloonPop);
                common.BalloonPopStruct.timestamp.write(view, performance.now());
                common.BalloonPopStruct.id.write(view, id);
                common.BalloonPopStruct.playerId.write(view, me.id);

                ws.send(view);
            }
        });
    });

    usernameInput.addEventListener("keydown", function (event) {
        if (event.key === 'Enter' && me) {
            if (!usernameInput.value) return console.log('no username entered');

            const view = new DataView(new ArrayBuffer(common.SetUsernameStruct.size));

            common.SetUsernameStruct.kind.write(view, common.MessageKind.SetUsername);
            common.SetUsernameStruct.id.write(view, me.id);
            common.SetUsernameStruct.value.write(view, common.stringToUint8Array(usernameInput.value.trim(), common.USERNAME_LENGTH));

            ws?.send(view);
        }
        // TODO: remove input and display loading spinner or some way of detailing that it is processing
    });

    usernameInput.addEventListener("input", function (event) {
        if (usernameInput.value.length > 8) usernameInput.value = usernameInput.value.slice(0, 8);
    });
})();
