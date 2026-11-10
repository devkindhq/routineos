// app/StoreContext.jsx: the one store instance every screen reads through, and the booted Desk model.
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const StoreContext = createContext(null);
const ModelContext = createContext(null);
const PatchContext = createContext(() => {});
const PageCommandsContext = createContext(() => {});

export function StoreProvider({ store, children }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function ModelProvider({ model, patch, children }) {
  return (
    <PatchContext.Provider value={patch || (() => {})}>
      <ModelContext.Provider value={model}>{children}</ModelContext.Provider>
    </PatchContext.Provider>
  );
}

// The shell's setter for the open page's palette commands [{id, label, run}]; a page sets them and clears them on leave.
export function PageCommandsProvider({ set, children }) {
  return <PageCommandsContext.Provider value={set}>{children}</PageCommandsContext.Provider>;
}

export function useSetPageCommands() {
  return useContext(PageCommandsContext);
}

export function useStore() {
  return useContext(StoreContext);
}

// The booted model (boot.js): definition, workspace, viewer, join, owner, lock, tour. null while loading.
export function useModel() {
  return useContext(ModelContext);
}

// The write context every page and Settings section passes to core/actions.js: {store, viewer, definition, join,
// owner, ownerTampered, canWriteShared}. One builder, so a gate such as canDecide (join and owner) reads the same fields everywhere.
export function usePageCtx() {
  const store = useStore();
  const model = useModel();
  return useMemo(() => ({ store: store, viewer: model.viewer, definition: model.definition, join: model.join,
    owner: model.owner, ownerTampered: model.ownerTampered, canWriteShared: model.canWriteShared }),
  [store, model.viewer, model.definition, model.join, model.owner, model.ownerTampered, model.canWriteShared]);
}

// patch({lock}) or patch({tourOff}): a settings write the shell must see at once (the lock state, the tour switch).
export function usePatchModel() {
  return useContext(PatchContext);
}

// Whether this view can save a file: null until the store answers, then true or false. Download hides unless true.
export function useCanDownload() {
  const store = useStore();
  const [can, setCan] = useState(null);
  useEffect(() => {
    let live = true;
    if (!store || typeof store.canDownload !== "function") {
      setCan(false);
      return undefined;
    }
    store.canDownload().then((yes) => { if (live) setCan(yes === true); }, () => { if (live) setCan(false); });
    return () => { live = false; };
  }, [store]);
  return can;
}
