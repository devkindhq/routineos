// app/Tour.jsx: the optional five-step starter tour (config.tour). It starts once by itself when the Desk was built with
// it, the owner has not switched it off (settings/workspace values.tour === false) and this browser has not finished
// it. Each step is a Popover anchored to the first visible element matching its target. Skip and Done write TOUR_KEY.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button, Group, Popover, Stack, Text } from "@mantine/core";

export var TOUR_KEY = "routineos-desk-tour-done";

export var TOUR_STEPS = [
  { id: "today", target: 'a[href="#/today"]', text: "Today is where a visit starts: what needs you now and what the routine did since you were last here." },
  { id: "approvals", target: 'a[href="#/approvals"]', text: "Approvals holds everything waiting on a person. Approve, reject or snooze, one at a time or in bulk." },
  { id: "items", target: 'a[href^="#/browse/"]', text: "Each record type has its own list. Filter it, sort it and save the view you come back to." },
  { id: "peek", target: 'main a[href^="#/entity/"], main a[href^="#/browse/"]', text: "Open a row to see it in the peek beside its list. Press o for the full page and Esc to close it." },
  { id: "bell", target: '[data-tour="bell"]', text: "The bell collects gates, failed runs and caps. Pinned rows at the top need you first." },
];

var FALLBACKS = ["#page-title"];

export function tourOn(model) {
  return !!(model && model.tour && !model.tourOff);
}

export function tourDismissed() {
  try { return globalThis.localStorage.getItem(TOUR_KEY) === "1"; } catch (e) { return false; }
}

export function dismissTour() {
  try { globalThis.localStorage.setItem(TOUR_KEY, "1"); } catch (e) { /* blocked: the tour may show again next visit */ }
}

// Drawn and inside the viewport across: a link in the closed phone drawer is drawn but off to the left.
function visible(el) {
  var r = el.getBoundingClientRect();
  var w = (el.ownerDocument.defaultView || globalThis).innerWidth;
  return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= w;
}

// The first visible match for the step, else the page title, else the body.
export function tourTarget(step, doc) {
  doc = doc || document;
  var sels = [step.target].concat(FALLBACKS);
  for (var i = 0; i < sels.length; i++) {
    var hit = Array.prototype.filter.call(doc.querySelectorAll(sels[i]), visible)[0];
    if (hit) return hit;
  }
  return doc.body;
}

const TourContext = createContext({ start: () => {}, available: false });

export function useTour() {
  return useContext(TourContext);
}

// Popover.Target hands its child a ref; this child renders nothing and passes the real element to that ref, so the
// popover is placed against an element the tour does not own.
function Anchor({ el, ref }) {
  useEffect(() => {
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
    return () => {
      if (typeof ref === "function") ref(null);
      else if (ref) ref.current = null;
    };
  }, [el, ref]);
  return null;
}

function TourStep({ index, onBack, onNext, onSkip }) {
  var step = TOUR_STEPS[index];
  const [el, setEl] = useState(null);
  useEffect(() => {
    var target = tourTarget(step);
    target.setAttribute("data-tour-target", step.id);
    setEl(target);
    return () => target.removeAttribute("data-tour-target");
  }, [index]);
  var last = index === TOUR_STEPS.length - 1;
  return (
    <Popover opened={!!el} position="bottom-start" width={320} withArrow shadow="md" trapFocus={false} closeOnClickOutside={false} hideDetached={false}
      middlewares={{ shift: { padding: 8 } }} onClose={onSkip}>
      <Popover.Target><Anchor el={el} /></Popover.Target>
      <Popover.Dropdown role="dialog" aria-label="Starter tour">
        <Stack gap="xs">
          <Text size="xs" c="dimmed">{"Step " + (index + 1) + " of " + TOUR_STEPS.length}</Text>
          <Text size="sm">{step.text}</Text>
          <Group justify="space-between">
            <Button size="xs" variant="subtle" color="gray" onClick={onSkip}>Skip</Button>
            <Group gap="xs">
              {index > 0 ? <Button size="xs" variant="default" onClick={onBack}>Back</Button> : null}
              <Button size="xs" onClick={onNext}>{last ? "Done" : "Next"}</Button>
            </Group>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

// ready: the Desk is drawn (booted, not locked). The tour starts by itself once, then only from start().
export function TourProvider({ model, ready, children }) {
  const [step, setStep] = useState(-1);
  const [auto, setAuto] = useState(false);
  var on = tourOn(model);
  useEffect(() => {
    if (ready && on && !auto && !tourDismissed()) {
      setAuto(true);
      setStep(0);
    }
  }, [ready, on, auto]);
  const start = useCallback(() => setStep(0), []);
  function finish() {
    dismissTour();
    setStep(-1);
  }
  const value = useMemo(() => ({ start: start, available: on }), [start, on]);
  return (
    <TourContext.Provider value={value}>
      {children}
      {ready && step >= 0 ? (
        <TourStep index={step} onSkip={finish} onBack={() => setStep(Math.max(0, step - 1))}
          onNext={() => (step === TOUR_STEPS.length - 1 ? finish() : setStep(step + 1))} />
      ) : null}
    </TourContext.Provider>
  );
}
