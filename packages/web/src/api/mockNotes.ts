/**
 * Where notes go in mock mode.
 *
 * The sample data is a set of read-only files, so a note added on the Grow
 * page has nowhere to be saved. In mock mode it is kept in this browser's
 * local storage instead, so it is still there after a reload. In live mode
 * this file is not used: notes go to the local service.
 */
import { Annotation } from "@devgym/shared";
import { z } from "zod";

export interface NoteStore {
  list(): Annotation[];
  add(note: Annotation): void;
  clear(): void;
}

const KEY = "ftc.mock.annotations";

/** Local storage can be missing or blocked; fall back to memory for the session. */
export function createNoteStore(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): NoteStore {
  let memory: Annotation[] = [];

  const read = (): Annotation[] => {
    if (!storage) return memory;
    try {
      const raw = storage.getItem(KEY);
      return raw ? z.array(Annotation).parse(JSON.parse(raw)) : [];
    } catch {
      return memory;
    }
  };

  const write = (notes: Annotation[]): void => {
    memory = notes;
    try {
      storage?.setItem(KEY, JSON.stringify(notes));
    } catch {
      // Kept in memory only.
    }
  };

  return {
    list: read,
    add: (note) => write([...read(), note]),
    clear: () => {
      memory = [];
      try {
        storage?.removeItem(KEY);
      } catch {
        // Nothing to remove.
      }
    },
  };
}

export function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
