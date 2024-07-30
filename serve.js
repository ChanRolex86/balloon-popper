const { spawn } = require('child_process');

function cmd(program, args = []) {
    const spawnOptions = { "shell": true };
    console.log('CMD:', program, args.flat(), spawnOptions);
    const p = spawn(program, args.flat(), spawnOptions);
    p.stdout.on('data', (data) => process.stdout.write(data));
    p.stderr.on('data', (data) => process.stderr.write(data));
    p.on('close', (code) => {
        if (code !== 0) console.error(program, args, 'exited with', code);
    });
    return p;
}

cmd('node', ['server.mjs'])

cmd('http-server', ['-p', '8080', '-a', '127.0.0.1', '-s', '-c-1', '-d', 'false'])
