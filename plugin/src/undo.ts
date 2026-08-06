import type { UndoRecord } from "./types";

export class UndoStack {
  private stack: UndoRecord[] = [];
  private readonly max = 50;

  push(record: UndoRecord): void {
    this.stack.push(record);
    if (this.stack.length > this.max) this.stack.shift();
  }

  pop(): UndoRecord | undefined {
    return this.stack.pop();
  }

  peek(): UndoRecord | undefined {
    return this.stack[this.stack.length - 1];
  }

  list(): UndoRecord[] {
    return this.stack.slice().reverse();
  }
}
