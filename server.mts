import { WebSocketServer } from 'ws';
import * as common from './common.mjs';

const wss = new WebSocketServer({
    port: common.SERVER_PORT
});

wss.on('connection', function connection(ws) {
    console.log('connection: ', ws);
    ws.on('error', console.error);

    ws.on('message', function message(data) {
        console.log('received: %s', data);
    });

    ws.send('something');
});

console.log(`Listening to ws://0.0.0.0:${common.SERVER_PORT}`);
