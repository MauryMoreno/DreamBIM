// The app's own modal dialogs (never window.confirm).

export type SaveChoice = 'save' | 'discard' | 'cancel';

let open = false;

/**
 * Modal dialog with a text and some buttons (the first is the main one). The focus starts on the
 * first one, Esc resolves `cancel` and Tab does not leave the dialog. When it closes it is removed from the DOM and the focus
 * goes back to where it was. If one is already open, the new request resolves `cancel` without being shown.
 */
function modal<T>(message: string, choices: readonly (readonly [string, T])[], cancel: T): Promise<T> {
  if (open) return Promise.resolve(cancel);
  open = true;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  const box = document.createElement('div');
  box.className = 'modal';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'modal-title');
  box.setAttribute('aria-describedby', 'modal-text');

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.id = 'modal-title';
  title.textContent = 'Dream BIM';
  const text = document.createElement('p');
  text.className = 'modal-text';
  text.id = 'modal-text';
  text.textContent = message;

  const row = document.createElement('div');
  row.className = 'modal-buttons';
  box.append(title, text, row);
  scrim.append(box);

  return new Promise<T>((resolve) => {
    const finish = (choice: T) => {
      scrim.remove();
      open = false;
      if (previous?.isConnected) previous.focus();
      resolve(choice);
    };
    const buttons = choices.map(([label, choice], i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = i === 0 ? 'modal-btn modal-btn-primary' : 'modal-btn';
      b.textContent = label;
      b.addEventListener('click', () => finish(choice));
      return b;
    });
    row.append(...buttons);

    // the keyboard does not leave the dialog: not even the workspace shortcuts see Esc or Del
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(cancel);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.shiftKey ? -1 : 1;
        buttons[(i + step + buttons.length) % buttons.length].focus();
      }
    });

    // un clic en el velo no le quita el foco a los botones
    scrim.addEventListener('mousedown', (e) => {
      if (e.target === scrim) e.preventDefault();
    });

    document.body.append(scrim);
    buttons[0].focus();
  });
}

/** «Save changes to <name>?» con Save / Don't Save / Cancel. */
export function askSaveChanges(name: string): Promise<SaveChoice> {
  return modal<SaveChoice>(
    `Save changes to ${name}?`,
    [
      ['Save', 'save'],
      ["Don't Save", 'discard'],
      ['Cancel', 'cancel'],
    ],
    'cancel',
  );
}

/** Confirmation question with `ok` / Cancel; true only if `ok` is chosen. */
export function askConfirm(message: string, ok: string): Promise<boolean> {
  return modal<boolean>(
    message,
    [
      [ok, true],
      ['Cancel', false],
    ],
    false,
  );
}

/** Asks for a text (e.g. the name of the author or of a folder); null if cancelled. */
export function askText(title: string, label: string, initial = ''): Promise<string | null> {
  if (open) return Promise.resolve(null);
  open = true;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  const box = document.createElement('div');
  box.className = 'modal';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.append(Object.assign(document.createElement('div'), { className: 'modal-title', textContent: title }));
  const field = document.createElement('label');
  field.className = 'modal-field';
  field.append(document.createTextNode(label));
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  input.className = 'modal-input';
  field.append(input);
  const row = document.createElement('div');
  row.className = 'modal-buttons';
  box.append(field, row);
  scrim.append(box);

  return new Promise<string | null>((resolve) => {
    const finish = (value: string | null) => {
      scrim.remove();
      open = false;
      if (previous?.isConnected) previous.focus();
      resolve(value);
    };
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'modal-btn modal-btn-primary';
    ok.textContent = 'OK';
    ok.addEventListener('click', () => finish(input.value));
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'modal-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => finish(null));
    const buttons = [ok, cancel];
    row.append(...buttons);
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        ok.click();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.shiftKey ? -1 : 1;
        buttons[(i + step + buttons.length) % buttons.length].focus();
      }
    });
    document.body.append(scrim);
    input.focus();
  });
}
