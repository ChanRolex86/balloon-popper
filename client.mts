import * as common from './common.mjs';
import type { Player } from './common.mjs';

(async () => {
    const gameCanvas = document.getElementById('game') as HTMLCanvasElement | null;
    if (gameCanvas === null) throw new Error('No element with id `game`');

    gameCanvas.width = common.WORLD_WIDTH;
    gameCanvas.height = common.WORLD_HEIGHT;

    const ctx = gameCanvas.getContext("2d");
    if (ctx === null) throw new Error('2d canvas is not supported');

    let ws: WebSocket | undefined = new WebSocket(`ws://${window.location.hostname}:${common.SERVER_PORT}`);

    let me: Player | undefined = undefined;

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

        ctx.fillStyle = '#202020';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        if (ws === undefined) {
            const label = "Disconnected";
            const size = ctx.measureText(label);
            ctx.font = "48px bold";
            ctx.fillStyle = "white";
            ctx.fillText(label, (ctx.canvas.width - size.width) / 2, ctx.canvas.height / 2);

        } else {
            ctx.font = "18px bold";
            ctx.fillStyle = "white";

            const padding = ctx.canvas.width * 0.05;
            ctx.fillText(`Ping: ${ping.toFixed(2)}ms`, padding, padding);

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
})();
