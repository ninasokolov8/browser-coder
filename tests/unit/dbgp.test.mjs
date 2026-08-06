/**
 * The DBGp wire format, without PHP.
 *
 * `tests/contract/php-debug.test.mjs` proves the debugger works against real Xdebug,
 * but it skips wherever the extension is absent - which is most contributors' laptops,
 * because Xdebug is a compiled PHP extension rather than something on a PATH. These
 * tests need nothing but Node, so the parts of the protocol that are pure parsing are
 * covered everywhere.
 *
 * The XML parser is the risky part. It is written for one machine-generated dialect,
 * and the failure mode of getting it slightly wrong is not an exception - it is a
 * variables panel quietly showing the wrong value.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { DbgpListener, DbgpSession, parseXml, pathFromUri, uriFromPath } from '../../languages/php/dbgp.mjs';

describe('parsing DBGp XML', () => {
  test('it reads attributes and nesting', () => {
    const document = parseXml(
      '<?xml version="1.0"?><response command="stack_get" transaction_id="5">' +
      '<stack where="{main}" level="0" filename="file:///job/main.php" lineno="10"></stack>' +
      '<stack where="twice" level="1" filename="file:///job/lib.php" lineno="3"></stack>' +
      '</response>',
    );

    assert.equal(document.name, 'response');
    assert.equal(document.attrs.command, 'stack_get');
    const frames = document.all('stack');
    assert.equal(frames.length, 2);
    assert.equal(frames[0].attrs.where, '{main}');
    assert.equal(frames[1].attrs.lineno, '3');
  });

  test('a self-closing element is not treated as an open one', () => {
    // Xdebug uses both forms for the same element depending on the command, and
    // treating `<x/>` as an opener silently nests everything after it inside x.
    const document = parseXml('<response><xdebug:message filename="f" lineno="7"/><other a="1"/></response>');
    assert.equal(document.children.length, 2);
    assert.equal(document.child('xdebug:message').attrs.lineno, '7');
    assert.equal(document.child('other').attrs.a, '1');
  });

  test('CDATA belongs to the element that contains it, not to its parent', () => {
    /*
     * The distinction that makes arrays work.
     *
     * A `<property>` holding a string has CDATA of its own; a `<property>` holding an
     * array has child `<property>` elements, each with their own CDATA. Merging text
     * into the parent would give the array the concatenation of its children.
     */
    const document = parseXml(
      '<response><property name="$list" type="array" numchildren="2">' +
      '<property name="0" type="int"><![CDATA[1]]></property>' +
      '<property name="1" type="int"><![CDATA[2]]></property>' +
      '</property></response>',
    );

    const list = document.child('property');
    assert.equal(list.text, '');
    assert.deepEqual(list.all('property').map(child => child.text), ['1', '2']);
  });

  test('entities in attribute values are decoded', () => {
    const document = parseXml('<response message="a &lt; b &amp;&amp; c &quot;d&quot;"/>');
    assert.equal(document.attrs.message, 'a < b && c "d"');
  });

  test('CDATA containing markup is taken literally', () => {
    // A student's string can contain anything. Treating `<b>` inside CDATA as an
    // element would both lose the value and desynchronise the element stack.
    const document = parseXml('<response><property><![CDATA[<b>bold</b> & "quoted"]]></property></response>');
    assert.equal(document.child('property').text, '<b>bold</b> & "quoted"');
  });

  test('an error response is an element, not an exception', () => {
    const document = parseXml(
      '<response command="eval"><error code="206"><message><![CDATA[syntax error]]></message></error></response>',
    );
    assert.equal(document.child('error').attrs.code, '206');
    assert.equal(document.child('error').child('message').text, 'syntax error');
  });

  test('malformed input returns null rather than throwing', () => {
    // A debugger that dies on a message shape it did not expect is worse than one
    // that ignores it.
    assert.equal(parseXml('not xml at all'), null);
    assert.doesNotThrow(() => parseXml('<response'));
    assert.doesNotThrow(() => parseXml('<response><![CDATA[unterminated'));
  });
});

describe('paths and URIs', () => {
  test('a URI round-trips through a path', () => {
    assert.equal(pathFromUri('file:///job/main.php'), '/job/main.php');
    assert.equal(uriFromPath('/job/main.php'), 'file:///job/main.php');
  });

  test('a space in a directory name survives both directions', () => {
    // Xdebug always percent-encodes, so comparing a raw URI against a real path
    // fails for exactly the students whose folder has a space in it.
    assert.equal(pathFromUri('file:///job/my%20work/main.php'), '/job/my work/main.php');
    assert.equal(uriFromPath('/job/my work/main.php'), 'file:///job/my%20work/main.php');
  });

  test('a Windows-style path is normalised to forward slashes', () => {
    assert.equal(uriFromPath('C:\\job\\main.php'), 'file:///C%3A/job/main.php');
  });

  test('an undecodable URI is returned as-is rather than throwing', () => {
    assert.equal(pathFromUri('file:///job/%ZZ.php'), '/job/%ZZ.php');
    assert.equal(pathFromUri(undefined), '');
  });
});

// ── Framing ─────────────────────────────────────────────────────────────────

/** A real pair of sockets, so the framing is tested over a real stream. */
async function connectedPair() {
  const listener = new DbgpListener();
  const port = await listener.listen();
  const client = net.connect(port, '127.0.0.1');
  await new Promise(resolve => client.once('connect', resolve));
  const session = await listener.session;
  return { listener, client, session };
}

/** `<length> NUL <body> NUL`, the way Xdebug sends everything. */
function framed(body) {
  return Buffer.concat([
    Buffer.from(String(Buffer.byteLength(body, 'utf8')), 'ascii'),
    Buffer.from([0]),
    Buffer.from(body, 'utf8'),
    Buffer.from([0]),
  ]);
}

describe('DBGp framing', () => {
  test('a message split across chunks is reassembled', async () => {
    const { listener, client, session } = await connectedPair();
    const packet = framed('<response command="run" status="break"/>');

    // Split inside the length digits, then inside the body.
    client.write(packet.subarray(0, 1));
    client.write(packet.subarray(1, 8));
    client.write(packet.subarray(8));

    const document = await session.next();
    assert.equal(document.attrs.status, 'break');
    client.destroy();
    listener.close();
  });

  test('two messages in one chunk are both delivered, in order', async () => {
    const { listener, client, session } = await connectedPair();
    client.write(Buffer.concat([
      framed('<response transaction_id="1"/>'),
      framed('<response transaction_id="2"/>'),
    ]));

    assert.equal((await session.next()).attrs.transaction_id, '1');
    assert.equal((await session.next()).attrs.transaction_id, '2');
    client.destroy();
    listener.close();
  });

  test('a multi-byte character is counted in bytes, not characters', async () => {
    // The length prefix is bytes. Counting characters leaves the parser one byte
    // short and every message after it is read from the wrong offset.
    const { listener, client, session } = await connectedPair();
    client.write(framed('<response name="café"/>'));
    assert.equal((await session.next()).attrs.name, 'café');
    client.destroy();
    listener.close();
  });

  test('commands are numbered and serialised, one at a time', async () => {
    const { listener, client, session } = await connectedPair();

    const seen = [];
    client.on('data', chunk => {
      for (const line of chunk.toString('utf8').split('\0')) {
        if (line) seen.push(line);
      }
    });

    const first = session.command('run');
    const second = session.command('stack_get');

    // DBGp allows exactly one outstanding command, so the second must not go out
    // until the first is answered.
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(seen, ['run -i 1']);

    client.write(framed('<response transaction_id="1" status="break"/>'));
    await first;
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(seen, ['run -i 1', 'stack_get -i 2']);

    client.write(framed('<response transaction_id="2"/>'));
    await second;
    client.destroy();
    listener.close();
  });

  test('the transaction id comes before the -- payload, never after', async () => {
    /*
     * The bug this pins.
     *
     * `--` means "everything after this is the base64 data", so `eval -- <data> -i 3`
     * makes the id part of the data. Xdebug answers every such command with
     * "invalid or missing options" and no transaction id at all.
     */
    const { listener, client, session } = await connectedPair();

    const seen = [];
    client.on('data', chunk => {
      for (const line of chunk.toString('utf8').split('\0')) if (line) seen.push(line);
    });

    session.command('eval', '', 'JHRvdGFs');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(seen[0], 'eval -i 1 -- JHRvdGFs');
    client.destroy();
    listener.close();
  });

  test('a disconnect answers the command in flight instead of hanging', async () => {
    const { listener, client, session } = await connectedPair();
    const pending = session.command('run');
    await new Promise(resolve => setTimeout(resolve, 30));
    client.destroy();
    assert.equal(await pending, null);
    assert.equal(session.closed, true);
    listener.close();
  });

  test('a garbage length prefix ends the stream rather than misreading it', async () => {
    // Without a valid length there is no way to find the next message boundary, so
    // continuing would mean reading arbitrary bytes as XML forever.
    const { listener, client, session } = await connectedPair();
    client.write(Buffer.concat([Buffer.from('notanumber', 'ascii'), Buffer.from([0]), Buffer.from('x', 'utf8')]));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(session.closed, true);
    client.destroy();
    listener.close();
  });
});

describe('the listener', () => {
  test('a second connection is dropped rather than replacing the live session', async () => {
    // A run produces one PHP process and therefore one engine. Swapping the session
    // out from under the IDE because something else dialled the port would leave the
    // debugger driving a program nobody is looking at.
    const listener = new DbgpListener();
    const port = await listener.listen();

    const first = net.connect(port, '127.0.0.1');
    await new Promise(resolve => first.once('connect', resolve));
    const session = await listener.session;
    assert.ok(session instanceof DbgpSession);

    const second = net.connect(port, '127.0.0.1');
    second.on('error', () => {});
    await new Promise(resolve => second.once('connect', resolve));
    // The listener destroys it immediately, so the far end sees the socket close.
    await new Promise(resolve => second.once('close', resolve));

    // The first session is untouched and still the one the listener reports.
    assert.equal(await listener.session, session);
    assert.equal(session.closed, false);

    first.destroy();
    listener.close();
  });
});
