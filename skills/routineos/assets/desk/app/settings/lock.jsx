// app/settings/lock.jsx: the optional privacy PIN (core/lock.js, spec 5.15). The section lets the Desk owner set,
// change or remove it; anyone else reads its state only. LockScreen is what the shell draws instead of the Desk while
// a valid PIN is set and this tab has not passed it.
import { useState } from "react";
import { Button, Card, Center, Group, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { canWrite, isDeskOwner, removeLockPin, setLockPin } from "../../core/actions.js";
import { LOCK_COPY, hashPin, rememberLockPass, validPin } from "../../core/lock.js";
import { useModel, usePatchModel } from "../StoreContext.jsx";
import { Section, useCtx } from "./common.jsx";

export function LockScreen({ lock, name, onPass }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function submit(e) {
    e.preventDefault();
    if (!validPin(pin)) { setError("Enter the six digits of the PIN."); return; }
    setBusy(true);
    hashPin(pin, lock.salt, lock.iterations).then((hash) => {
      setBusy(false);
      if (hash !== lock.hash) { setError("That PIN is not right."); return; }
      rememberLockPass(lock.salt);
      onPass();
    }, () => {
      setBusy(false);
      setError("This browser cannot check the PIN.");
    });
  }
  return (
    <Center mih="100vh" p="md">
      <Card withBorder padding="lg" w="100%" maw={380} component="main">
        <form onSubmit={submit}>
          <Stack>
            <Title order={1} size="h2">{name}</Title>
            <Text size="sm" c="dimmed">{LOCK_COPY}</Text>
            <PasswordInput label="PIN" description="6 digits" inputMode="numeric" autoComplete="off" maxLength={6} autoFocus
              value={pin} error={error || undefined} onChange={(e) => { setPin(e.currentTarget.value); setError(""); }} />
            <Button type="submit" loading={busy}>Open the Desk</Button>
            <Text size="sm" c="dimmed">Forgot the PIN? Ask the owner to remove it in Settings.</Text>
          </Stack>
        </form>
      </Card>
    </Center>
  );
}

function RemoveControl({ busy, onRemove }) {
  const [asking, setAsking] = useState(false);
  const [word, setWord] = useState("");
  if (!asking) return <Button variant="default" color="red" disabled={busy} onClick={() => setAsking(true)}>Remove PIN</Button>;
  return (
    <Stack gap="xs">
      <TextInput label="Type remove to take the PIN off" value={word} onChange={(e) => setWord(e.currentTarget.value)} />
      <Group gap="xs">
        <Button color="red" disabled={word.trim().toLowerCase() !== "remove"} loading={busy} onClick={onRemove}>Remove the PIN</Button>
        <Button variant="default" onClick={() => { setAsking(false); setWord(""); }}>Cancel</Button>
      </Group>
    </Stack>
  );
}

export default function Lock() {
  const ctx = useCtx();
  const model = useModel();
  const patch = usePatchModel();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  var set = !!model.lock;
  var w = canWrite(ctx);
  var owner = isDeskOwner(ctx) && !ctx.ownerTampered;

  function submit(e) {
    e.preventDefault();
    if (!validPin(pin)) { setError("Enter six digits."); return; }
    if (pin !== again) { setError("The two PINs do not match."); return; }
    setBusy(true);
    setLockPin(ctx, pin).then((doc) => {
      setBusy(false);
      setPin("");
      setAgain("");
      setError("");
      patch({ lock: doc });
      notifications.show({ message: set ? "PIN changed." : "PIN set. This tab stays open." });
    }, () => {
      setBusy(false);
      setError("The PIN could not be saved. Try again.");
    });
  }
  function onRemove() {
    setBusy(true);
    removeLockPin(ctx).then(() => {
      setBusy(false);
      patch({ lock: null });
      notifications.show({ message: "PIN removed." });
    }, () => {
      setBusy(false);
      setError("The PIN could not be removed. Try again.");
    });
  }

  var controls;
  if (!w.ok) controls = <Text size="sm" c="dimmed" role="status">{w.reason + ". The PIN cannot be changed here."}</Text>;
  else if (!owner) controls = <Text size="sm" c="dimmed">Only the owner can set, change or remove the PIN.</Text>;
  else {
    controls = (
      <Stack gap="sm">
        <form onSubmit={submit}>
          <Stack gap="sm">
            <PasswordInput label="New PIN (6 digits)" inputMode="numeric" autoComplete="new-password" maxLength={6}
              value={pin} onChange={(e) => { setPin(e.currentTarget.value); setError(""); }} />
            <PasswordInput label="Repeat the PIN" inputMode="numeric" autoComplete="new-password" maxLength={6}
              value={again} error={error || undefined} onChange={(e) => { setAgain(e.currentTarget.value); setError(""); }} />
            <Group><Button type="submit" loading={busy}>{set ? "Change PIN" : "Set PIN"}</Button></Group>
          </Stack>
        </form>
        {set ? <Group><RemoveControl busy={busy} onRemove={onRemove} /></Group> : null}
      </Stack>
    );
  }
  return (
    <Section id="lock" title="Privacy PIN" note={LOCK_COPY}>
      <Text data-lock-state={set ? "set" : "none"}>{set ? "A PIN is set. Each browser tab asks for it once." : "No PIN is set."}</Text>
      {controls}
    </Section>
  );
}
