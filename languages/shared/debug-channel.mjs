import net from 'node:net';

/**
 * The NDJSON socket shared by the native-runtime debugger supervisors.
 *
 * Language adapters own debugger-specific commands. This module owns only transport:
 * ordered frame parsing, serialized command handling, safe writes, and idempotent
 * shutdown.
 */
export function createIdeDebugChannel(port) {
  const socket = net.connect(port, '127.0.0.1');
  socket.setNoDelay(true);

  let closed = false;

  const send = frame => {
    if (closed || socket.destroyed) return;
    try {
      socket.write(`${JSON.stringify(frame)}\n`);
    } catch {
      // Losing the debugger UI must not lose the student's run.
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    try { socket.end(); } catch { /* already gone */ }
  };

  socket.on('error', () => { closed = true; });
  socket.on('close', () => { closed = true; });

  const handleCommands = ({ ready = Promise.resolve(), handleCommand, reportError }) => {
    let buffer = '';
    let handling = Promise.resolve(ready);

    const onData = chunk => {
      buffer += chunk.toString('utf8');
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;

        let command;
        try {
          command = JSON.parse(line);
        } catch {
          // A malformed frame must not end the session.
          continue;
        }

        handling = handling
          .then(() => handleCommand(command), () => handleCommand(command))
          .catch(reportError);
      }
    };

    socket.on('data', onData);
    return () => socket.off('data', onData);
  };

  return { socket, send, close, handleCommands };
}
