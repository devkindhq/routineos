// app/settings/appearance.jsx: this viewer's theme, density, motion and pinch zoom, kept in this browser under the earlier keys.
import { SegmentedControl, Stack, Text, useMantineColorScheme } from "@mantine/core";
import { usePrefs } from "../usePrefs.js";
import { Section } from "./common.jsx";

var CHOICES = [
  ["theme", "Theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]]],
  ["density", "Density", [["comfortable", "Comfortable"], ["compact", "Compact"]]],
  ["motion", "Motion", [["system", "Follow the system"], ["reduce", "Reduce"]]],
  ["zoom", "Allow pinch zoom", [["lock", "Off"], ["allow", "On"]]],
];

export default function Appearance() {
  const prefs = usePrefs();
  const { setColorScheme } = useMantineColorScheme();
  function pick(key, v) {
    prefs.set(key, v);
    if (key === "theme") setColorScheme(v === "system" ? "auto" : v);
  }
  return (
    <Section id="appearance" title="Appearance" note="These choices are kept in this browser only.">
      {CHOICES.map(([key, label, data]) => (
        <Stack key={key} gap={4}>
          <Text size="sm" fw={500}>{label}</Text>
          <SegmentedControl aria-label={label} value={prefs[key]} onChange={(v) => pick(key, v)}
            data={data.map(([value, l]) => ({ value: value, label: l }))} />
        </Stack>
      ))}
    </Section>
  );
}
