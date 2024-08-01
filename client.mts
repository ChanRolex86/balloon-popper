import * as common from './common.mjs';
import type { Player, Balloon } from './common.mjs';

(async () => {
    const infoCanvas = document.getElementById('info') as HTMLCanvasElement | null;
    const gameCanvas = document.getElementById('game') as HTMLCanvasElement | null;

    if (infoCanvas === null) throw new Error('No element with id `info`');
    if (gameCanvas === null) throw new Error('No element with id `game`');

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

    const balloons = new Map<number, Balloon>();
    const balloonPaths = new Map<number, Path2D>();

    let ping = 0;

    ws.binaryType = 'arraybuffer';

    ws.addEventListener("open", (event) => {
        console.log("WEBSOCKET OPEN", event);
    });

    ws.addEventListener("close", (event) => {
        console.log("WEBSOCKET CLOSE", event);
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
                    id: common.HelloStruct.id.read(view)
                }
            } else {
                console.error("Received bs message from server. Incorrect `Hello` message.", view);
                ws?.close();
            }
        } else {
            if (common.PongStruct.verify(view)) {
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

                console.log("balloon created");
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
            if (gameCtx.isPointInPath(balloonPath, event.offsetX, event.offsetY)) {
                console.log("balloon clicked");
            }
        });
    });
})();
