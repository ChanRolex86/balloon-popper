export const SERVER_PORT = 8081;
export const WORLD_FACTOR = 200;

export const WORLD_WIDTH = 4 * WORLD_FACTOR;
export const WORLD_HEIGHT = 3 * WORLD_FACTOR;

export const PADDING = WORLD_HEIGHT * 0.05;

export const BALLOON_SIZE = 10;

export const USERNAME_LENGTH = 8;

export interface Balloon {
    id: number,
    x: number,
    y: number,
    hue: number,
    timestamp: number
}

export interface Player {
    id: number,
    username: Uint8Array | undefined
}

export enum MessageKind {
    Hello,
    Ping,
    Pong,
    BalloonCreated,
    BalloonPop,
    SetUsername,
    ValidUsername
}

interface Field {
    offset: number,
    size: number,
    read(view: DataView): any;
    write(view: DataView, value: any): void;
}

interface NumberField extends Field {
    read(view: DataView): number;
    write(view: DataView, value: number): void;
}

interface Uint8ArrayField extends Field {
    read(view: DataView): Uint8Array;
    write(view: DataView, value: Uint8Array): void;
}

export const UINT8_SIZE = 1;
export const UINT16_SIZE = 2;
export const UINT32_SIZE = 4;
export const FLOAT32_SIZE = 4;

function allocUint8Field(allocator: { size: number }): NumberField {
    const offset = allocator.size;
    const size = UINT8_SIZE;

    allocator.size += size;
    return {
        offset,
        size,
        read: (view) => view.getUint8(offset),
        write: (view, value) => view.setUint8(offset, value)
    }
}

function allocUint16Field(allocator: { size: number }): NumberField {
    const offset = allocator.size;
    const size = UINT16_SIZE;

    allocator.size += size;
    return {
        offset,
        size,
        read: (view) => view.getUint16(offset),
        write: (view, value) => view.setUint16(offset, value)
    }
}

function allocUint32Field(allocator: { size: number }): NumberField {
    const offset = allocator.size;
    const size = UINT32_SIZE;

    allocator.size += size;
    return {
        offset,
        size,
        read: (view) => view.getUint32(offset, true),
        write: (view, value) => view.setUint32(offset, value, true)
    }
}

function allocUint8ArrayField(allocator: { size: number }, length: number): Uint8ArrayField {
    const offset = allocator.size;
    const size = UINT8_SIZE * length;

    allocator.size += size;

    return {
        offset,
        size,
        read: (view) => {
            const array = new Uint8Array(length);
            for (let i = 0; i < length; i++) {
                array[i] = view.getUint8(offset + i);
            }
            return array;
        },
        write: (view, value: Uint8Array) => {
            for (let i = 0; i < length; i++) {
                view.setUint8(offset + i, value[i] || 0);
            }
        }
    }
}

function allocFloat32Field(allocator: { size: number }): NumberField {
    const offset = allocator.size;
    const size = FLOAT32_SIZE;

    allocator.size += size;
    return {
        offset,
        size,
        read: (view) => view.getFloat32(offset, true),
        write: (view, value) => view.setFloat32(offset, value, true)
    }
}

function verifier(kindField: Field, kind: number, size: number): (view: DataView) => boolean {
    return (view) => view.byteLength == size && kindField.read(view) == kind;
}

export const HelloStruct = (() => {
    const allocator = { size: 0 };
    const kind = allocUint8Field(allocator);
    const id = allocUint32Field(allocator);
    const size = allocator.size;
    const verify = verifier(kind, MessageKind.Hello, size);

    return { kind, id, size, verify };
})();

export const SetUsernameStruct = (() => {
    const allocator = { size: 0 };
    const kind = allocUint8Field(allocator);
    const id = allocUint8Field(allocator);
    const value = allocUint8ArrayField(allocator, USERNAME_LENGTH);
    const size = allocator.size;
    const verify = verifier(kind, MessageKind.SetUsername, size);

    return { kind, id, value, size, verify };
})();

export const ValidUsernameStruct = (() => {
    const allocator = { size: 0 };
    const kind = allocUint8Field(allocator);
    const value = allocUint8ArrayField(allocator, USERNAME_LENGTH);
    const valid = allocUint8Field(allocator);
    const size = allocator.size;
    const verify = verifier(kind, MessageKind.ValidUsername, size);

    return { kind, value, valid, size, verify };
})();

export const PingStruct = (() => {
    const allocator = { size: 0 };
    const kind = allocUint8Field(allocator);
    const timestamp = allocUint32Field(allocator);
    const size = allocator.size;
    const verify = verifier(kind, MessageKind.Ping, size);

    return { kind, timestamp, size, verify };
})();

export const PongStruct = (() => {
    const allocator = { size: 0 };
    const kind = allocUint8Field(allocator);
    const timestamp = allocUint32Field(allocator);
    const size = allocator.size;
    const verify = verifier(kind, MessageKind.Pong, size);

    return { kind, timestamp, size, verify };
})();

export const BalloonCreatedStruct = (() => {
    const allocator = { size: 0 };
    const kind = allocUint8Field(allocator);
    const timestamp = allocUint32Field(allocator);
    const id = allocUint32Field(allocator);
    const x = allocFloat32Field(allocator);
    const y = allocFloat32Field(allocator);
    const hue = allocUint8Field(allocator);
    const size = allocator.size;
    const verify = verifier(kind, MessageKind.BalloonCreated, size);

    return { kind, timestamp, id, x, y, hue, size, verify };
})();

export const BalloonPopStruct = (() => {
    const allocator = { size: 0 };
    const kind = allocUint8Field(allocator);
    const timestamp = allocUint32Field(allocator);
    const id = allocUint32Field(allocator);
    const size = allocator.size;
    const verify = verifier(kind, MessageKind.BalloonPop, size);

    return { kind, timestamp, id, size, verify };
})();


export function stringToUint8Array(str: string, length: number): Uint8Array {
    const array = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        array[i] = (str.charCodeAt(i) || 0);
    }
    return array;
}
