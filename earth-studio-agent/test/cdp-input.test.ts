/**
 * The input the browser itself delivers, described as protocol commands.
 *
 * Earth Studio ignores events made in JavaScript, so these commands are the
 * only thing that opens a value field from inside an extension. They are worth
 * checking precisely: a wrong virtual key code is a keystroke that arrives as
 * nothing at all.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { clickCommands, keyCommands, textCommands } from '../src/extension/cdp-input.ts';
import { extensionInput } from '../src/extension/trusted-input.ts';

describe('clickCommands', () => {
  test('moves, presses and releases at whole pixels', () => {
    const commands = clickCommands(317.4, 544.6);
    assert.deepEqual(commands.map((command) => command.params.type), ['mouseMoved', 'mousePressed', 'mouseReleased']);
    for (const command of commands) {
      assert.equal(command.method, 'Input.dispatchMouseEvent');
      assert.equal(command.params.x, 317);
      assert.equal(command.params.y, 545);
    }
    assert.equal(commands[1]?.params.button, 'left');
    assert.equal(commands[1]?.params.buttons, 1);
    assert.equal(commands[1]?.params.clickCount, 1);
    assert.equal(commands[2]?.params.buttons, 0);
  });
});

describe('keyCommands', () => {
  test('sends Enter with the text a real Enter carries', () => {
    const [down, up] = keyCommands('Enter');
    assert.equal(down?.params.type, 'keyDown');
    assert.equal(down?.params.text, '\r');
    assert.equal(down?.params.windowsVirtualKeyCode, 13);
    assert.equal(up?.params.type, 'keyUp');
  });

  test('sends an arrow as a raw key, with no text', () => {
    const [down] = keyCommands('ArrowRight');
    assert.equal(down?.params.type, 'rawKeyDown');
    assert.equal(down?.params.windowsVirtualKeyCode, 39);
    assert.equal(down?.params.text, undefined);
  });

  test('reads the modifiers the driver writes', () => {
    assert.equal(keyCommands('Shift+ArrowRight')[0]?.params.modifiers, 8);
    assert.equal(keyCommands('Control+a')[0]?.params.modifiers, 2);
    // Ctrl+A is a shortcut, not the letter a: it must not carry text.
    assert.equal(keyCommands('Control+a')[0]?.params.text, undefined);
    assert.equal(keyCommands('Control+a')[0]?.params.type, 'rawKeyDown');
  });

  test('sends a printable key as itself', () => {
    const [down] = keyCommands('a');
    assert.equal(down?.params.type, 'keyDown');
    assert.equal(down?.params.text, 'a');
    assert.equal(down?.params.code, 'KeyA');
  });

  test('Home and End are the keys the playhead uses', () => {
    assert.equal(keyCommands('Home')[0]?.params.windowsVirtualKeyCode, 36);
    assert.equal(keyCommands('End')[0]?.params.windowsVirtualKeyCode, 35);
  });
});

describe('textCommands', () => {
  test('inserts the whole string at once', () => {
    assert.deepEqual(textCommands('35.3606'), [
      { method: 'Input.insertText', params: { text: '35.3606' } },
    ]);
  });
});

describe('extensionInput', () => {
  const messenger = (answer: { ok?: boolean; error?: string } | undefined, lastError?: string) => {
    const sent: unknown[] = [];
    return {
      sent,
      runtime: {
        sendMessage(message: unknown, callback: (response: typeof answer) => void): void {
          sent.push(message);
          callback(answer);
        },
        get lastError() {
          return lastError === undefined ? undefined : { message: lastError };
        },
      },
    };
  };

  test('asks the worker for a click at a point', async () => {
    const { sent, runtime } = messenger({ ok: true });
    await extensionInput(runtime).click(10, 20);
    assert.deepEqual(sent, [{ type: 'input', action: 'click', x: 10, y: 20 }]);
  });

  test('a refusal is answered once and remembered', async () => {
    const { sent, runtime } = messenger({ ok: false, error: 'Cannot attach' });
    const input = extensionInput(runtime);
    assert.equal(await input.available(), false);
    assert.equal(await input.available(), false);
    // Asking Chrome to attach a debugger is not free, and a refusal does not
    // change its mind mid-run.
    assert.equal(sent.length, 1);
  });

  test('a working worker is available', async () => {
    const { runtime } = messenger({ ok: true });
    assert.equal(await extensionInput(runtime).available(), true);
  });

  test('a failed keystroke is an error the driver can see', async () => {
    const { runtime } = messenger({ ok: false, error: 'Detached while sending' });
    await assert.rejects(() => extensionInput(runtime).key('Enter'), /Detached while sending/);
  });

  test('releasing never throws, because it runs in a finally', async () => {
    const { runtime } = messenger(undefined, 'The message port closed');
    await extensionInput(runtime).release();
  });
});
