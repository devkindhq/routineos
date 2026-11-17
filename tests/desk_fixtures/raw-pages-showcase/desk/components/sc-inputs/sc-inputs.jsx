import { Component, useState } from "react";
import {
  Autocomplete, AlphaSlider, AngleSlider, Button, Cascader, CheckIcon, Checkbox, Chip, ColorInput, ColorPicker, Combobox,
  ComboboxPopover, FileButton, FileInput, Fieldset, Group, HueSlider, Input, InputBase, InputClearSection, JsonInput,
  MaskInput, MultiSelect, NativeSelect, NumberInput, Paper, PasswordInput, Pill, PillsInput, PinInput, Radio,
  RadioIcon, RangeSlider, Rating, SegmentedControl, Select, SimpleGrid, Slider, Stack, Switch, TagsInput, Text,
  TextInput, Textarea, Title, TreeSelect, useCombobox,
} from "@mantine/core";

class CellBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) return <Text c="red" data-cell-failed={this.props.name}>FAILED {this.props.name}: {String(this.state.err.message)}</Text>;
    return this.props.children;
  }
}
function Cell({ name, children }) {
  return (
    <Paper withBorder p="xs" data-cell={name}>
      <Text size="xs" ff="monospace" c="dimmed" mb={6}>{name}</Text>
      <CellBoundary name={name}>{children}</CellBoundary>
    </Paper>
  );
}

const fruit = ["Apple", "Banana", "Cherry", "Date"];
const cascade = [
  { value: "au", label: "Australia", children: [{ value: "vic", label: "Victoria", children: [{ value: "mel", label: "Melbourne" }] }, { value: "nsw", label: "New South Wales" }] },
  { value: "nz", label: "New Zealand", children: [{ value: "akl", label: "Auckland" }] },
];
const tree = [
  { value: "src", label: "src", children: [{ value: "src/a.js", label: "a.js" }, { value: "src/b.js", label: "b.js" }] },
  { value: "docs", label: "docs", children: [{ value: "docs/readme", label: "readme" }] },
];

function ComboboxDemo() {
  const [value, setValue] = useState("Apple");
  const combobox = useCombobox({ defaultOpened: true });
  return (
    <div style={{ minHeight: 280 }}>
      <Combobox store={combobox} withinPortal={false} onOptionSubmit={(v) => { setValue(v); combobox.closeDropdown(); }}>
        <Combobox.Target>
          <InputBase component="button" type="button" pointer rightSection={<Combobox.Chevron />} onClick={() => combobox.toggleDropdown()} label="Combobox.Target">
            {value}
          </InputBase>
        </Combobox.Target>
        <Combobox.Dropdown>
          <Combobox.Header><Text size="xs" c="dimmed" p={4}>Combobox.Header</Text></Combobox.Header>
          <Combobox.Search placeholder="Combobox.Search" />
          <Combobox.Options>
            <Combobox.Group label="Combobox.Group">
              {fruit.map((f) => <Combobox.Option key={f} value={f}>{f}</Combobox.Option>)}
            </Combobox.Group>
            <Combobox.Empty>Combobox.Empty</Combobox.Empty>
          </Combobox.Options>
          <Combobox.Footer><Text size="xs" c="dimmed" p={4}>Combobox.Footer</Text></Combobox.Footer>
        </Combobox.Dropdown>
      </Combobox>
    </div>
  );
}

function PillsCombobox() {
  const [values, setValues] = useState(["Apple"]);
  const combobox = useCombobox({ defaultOpened: false });
  return (
    <div style={{ minHeight: 60 }}>
      <Combobox store={combobox} withinPortal={false} onOptionSubmit={(v) => setValues((c) => (c.includes(v) ? c : [...c, v]))}>
        <Combobox.DropdownTarget>
          <PillsInput onClick={() => combobox.openDropdown()} rightSection={<Combobox.ClearButton onClear={() => setValues([])} />}>
            <Pill.Group>
              {values.map((v) => <Pill key={v} withRemoveButton onRemove={() => setValues((c) => c.filter((x) => x !== v))}>{v}</Pill>)}
              <Combobox.EventsTarget>
                <PillsInput.Field placeholder="Combobox.EventsTarget" onFocus={() => combobox.openDropdown()} />
              </Combobox.EventsTarget>
            </Pill.Group>
          </PillsInput>
        </Combobox.DropdownTarget>
        <Combobox.Dropdown>
          <Combobox.Options>{fruit.map((f) => <Combobox.Option key={f} value={f}>{f}</Combobox.Option>)}</Combobox.Options>
        </Combobox.Dropdown>
        <Combobox.HiddenInput value={values} name="showcase-pills" />
      </Combobox>
    </div>
  );
}

export default function InputsShowcase() {
  const [file, setFile] = useState(null);
  const [color, setColor] = useState("#228be6");
  const [angle, setAngle] = useState(90);
  const [alpha, setAlpha] = useState(0.6);
  const [hue, setHue] = useState(200);
  const [pop, setPop] = useState(["Banana"]);
  return (
    <Stack gap="md">
      <Title order={3}>Inputs showcase</Title>
      <Text size="sm" c="dimmed">Every input component and the Input, Combobox, Checkbox, Radio, Switch, Pill and PillsInput parts. Parts are rendered with their dotted names.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        <Cell name="TextInput"><TextInput label="TextInput" placeholder="Type here" description="Description" /></Cell>
        <Cell name="Textarea"><Textarea label="Textarea" autosize minRows={2} defaultValue="Several lines of demo text." /></Cell>
        <Cell name="PasswordInput"><PasswordInput label="PasswordInput" defaultValue="demo-not-a-secret" /></Cell>
        <Cell name="NumberInput"><NumberInput label="NumberInput" defaultValue={42} min={0} max={100} /></Cell>
        <Cell name="MaskInput"><MaskInput label="MaskInput" mask="(000) 000-0000" placeholder="(555) 000-0000" /></Cell>
        <Cell name="PinInput"><PinInput length={4} defaultValue="12" aria-label="PinInput" /></Cell>
        <Cell name="Select"><Select label="Select" data={fruit} defaultValue="Banana" /></Cell>
        <Cell name="NativeSelect"><NativeSelect label="NativeSelect" data={fruit} /></Cell>
        <Cell name="MultiSelect"><MultiSelect label="MultiSelect" data={fruit} defaultValue={["Apple", "Date"]} /></Cell>
        <Cell name="TagsInput"><TagsInput label="TagsInput" defaultValue={["alpha", "beta"]} /></Cell>
        <Cell name="Autocomplete"><Autocomplete label="Autocomplete" data={fruit} defaultValue="Ban" /></Cell>
        <Cell name="Cascader"><Cascader label="Cascader" data={cascade} defaultValue={["au", "vic"]} /></Cell>
        <Cell name="TreeSelect"><TreeSelect label="TreeSelect" data={tree} defaultExpandAll /></Cell>
        <Cell name="JsonInput"><JsonInput label="JsonInput" formatOnBlur autosize minRows={3} defaultValue='{"demo": true, "n": 3}' /></Cell>
        <Cell name="FileInput FileButton">
          <FileInput label="FileInput" placeholder="Pick a file" />
          <Group mt="xs"><FileButton onChange={setFile} accept="text/plain">{(p) => <Button {...p} size="xs">FileButton</Button>}</FileButton><Text size="xs">{file ? file.name : "no file"}</Text></Group>
        </Cell>
        <Cell name="ColorInput ColorPicker"><ColorInput label="ColorInput" value={color} onChange={setColor} /><ColorPicker mt="xs" value={color} onChange={setColor} /></Cell>
        <Cell name="HueSlider AlphaSlider AngleSlider">
          <HueSlider value={hue} onChange={setHue} aria-label="HueSlider" />
          <AlphaSlider mt="xs" color="#228be6" value={alpha} onChange={setAlpha} aria-label="AlphaSlider" />
          <AngleSlider mt="xs" value={angle} onChange={setAngle} aria-label="AngleSlider" />
        </Cell>
        <Cell name="Slider RangeSlider">
          <Slider defaultValue={40} marks={[{ value: 0, label: "0" }, { value: 100, label: "100" }]} aria-label="Slider" />
          <RangeSlider mt="lg" defaultValue={[20, 70]} aria-label="RangeSlider" />
        </Cell>
        <Cell name="Rating"><Rating defaultValue={3} /></Cell>
        <Cell name="SegmentedControl"><SegmentedControl data={["Day", "Week", "Month"]} defaultValue="Week" /></Cell>
        <Cell name="Checkbox Checkbox.Group Checkbox.Indicator Checkbox.Card CheckIcon">
          <Checkbox label="Checkbox" defaultChecked />
          <Checkbox.Group label="Checkbox.Group" defaultValue={["a"]} mt="xs">
            <Group><Checkbox value="a" label="A" /><Checkbox value="b" label="B" /></Group>
          </Checkbox.Group>
          <Group mt="xs" gap="xs"><Checkbox.Indicator checked /><Text size="xs">Checkbox.Indicator</Text><CheckIcon size={12} /><Text size="xs">CheckIcon</Text></Group>
          <Checkbox.Card mt="xs" p="xs" radius="md" checked onChange={() => {}}><Text size="sm">Checkbox.Card</Text></Checkbox.Card>
        </Cell>
        <Cell name="Radio Radio.Group Radio.Indicator Radio.Card RadioIcon">
          <Radio.Group label="Radio.Group" defaultValue="x">
            <Group><Radio value="x" label="X" /><Radio value="y" label="Y" /></Group>
            <Radio.Card value="card" mt="xs" p="xs" radius="md"><Text size="sm">Radio.Card</Text></Radio.Card>
          </Radio.Group>
          <Group mt="xs" gap="xs"><Radio.Indicator checked /><Text size="xs">Radio.Indicator</Text><RadioIcon size={12} /><Text size="xs">RadioIcon</Text></Group>
        </Cell>
        <Cell name="Switch Switch.Group">
          <Switch label="Switch" defaultChecked />
          <Switch.Group label="Switch.Group" defaultValue={["s1"]} mt="xs">
            <Group><Switch value="s1" label="One" /><Switch value="s2" label="Two" /></Group>
          </Switch.Group>
        </Cell>
        <Cell name="Chip Chip.Group">
          <Chip defaultChecked>Chip</Chip>
          <Chip.Group multiple defaultValue={["c1"]}><Group mt="xs"><Chip value="c1">c1</Chip><Chip value="c2">c2</Chip></Group></Chip.Group>
        </Cell>
        <Cell name="Pill Pill.Group PillsInput PillsInput.Field">
          <PillsInput label="PillsInput">
            <Pill.Group><Pill withRemoveButton>Pill</Pill><Pill>Pill.Group</Pill><PillsInput.Field placeholder="PillsInput.Field" /></Pill.Group>
          </PillsInput>
        </Cell>
        <Cell name="Input Input.Wrapper Input.Label Input.Description Input.Error Input.Success Input.Placeholder Input.ClearButton InputBase InputClearSection">
          <Input.Wrapper label={<Input.Label>Input.Label</Input.Label>} description={<Input.Description>Input.Description</Input.Description>} error={<Input.Error>Input.Error</Input.Error>}>
            <Input placeholder="Input" rightSection={<Input.ClearButton onClick={() => {}} />} />
          </Input.Wrapper>
          <Input.Success mt={4}>Input.Success</Input.Success>
          <Input component="button" type="button" mt="xs" pointer><Input.Placeholder>Input.Placeholder</Input.Placeholder></Input>
          <InputBase mt="xs" placeholder="InputBase" rightSection={<InputClearSection>X</InputClearSection>} />
        </Cell>
        <Cell name="Fieldset"><Fieldset legend="Fieldset"><TextInput label="Inside" /></Fieldset></Cell>
        <Cell name="Combobox Combobox.Target Combobox.Dropdown Combobox.Options Combobox.Option Combobox.Search Combobox.Empty Combobox.Chevron Combobox.Footer Combobox.Header Combobox.Group"><ComboboxDemo /></Cell>
        <Cell name="Combobox.EventsTarget Combobox.DropdownTarget Combobox.ClearButton Combobox.HiddenInput"><PillsCombobox /></Cell>
        <Cell name="ComboboxPopover ComboboxPopover.Target">
          <ComboboxPopover multiple data={fruit} value={pop} onChange={setPop} defaultDropdownOpened comboboxProps={{ withinPortal: false }}>
            <ComboboxPopover.Target><Button variant="default">ComboboxPopover ({pop.length})</Button></ComboboxPopover.Target>
          </ComboboxPopover>
          <div style={{ minHeight: 200 }} />
        </Cell>
      </SimpleGrid>
    </Stack>
  );
}
