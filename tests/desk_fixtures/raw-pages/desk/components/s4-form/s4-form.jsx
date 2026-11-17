import { useState } from "react";
import { Alert, Button, Group, MultiSelect, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import dayjs from "dayjs";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";

const OWNERS = ["Avery Test", "Blake Sample", "Casey Demo", "Drew Example"];
const LABELS = ["billing", "content", "infra", "support"];

function slug(title) {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export default function Form({ ctx }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState(null);
  const [labels, setLabels] = useState([]);
  const [urgent, setUrgent] = useState(false);
  const [due, setDue] = useState(null);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);

  function validate() {
    const e = {};
    if (title.trim().length < 3) e.title = "Enter a title of at least 3 characters";
    else if (!slug(title)) e.title = "Use letters or numbers in the title";
    if (!owner) e.owner = "Pick an owner";
    if (!due) e.due = "Pick a due date";
    else if (dayjs(due).isBefore(dayjs("2026-09-01"))) e.due = "The due date is before this project started";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function save() {
    if (!validate()) return;
    const fields = {
      title: title.trim(), status: "todo", owner: owner, due: dayjs(due).format("YYYY-MM-DD"),
      amount: 0, labels: labels.join(", "), urgent: urgent,
    };
    ctx.actions.upsert("task", slug(title), fields).then(
      () => {
        setResult({ ok: true, text: "Saved " + fields.title });
        notifications.show({ color: "teal", title: "Saved", message: fields.title, icon: <IconCheck size={16} /> });
      },
      (err) => {
        setResult({ ok: false, text: "Not saved: " + err.message });
        notifications.show({ color: "red", title: "Not saved", message: err.message });
      });
  }

  return (
    <Stack gap="md" maw={480}>
      <TextInput label="Title" withAsterisk value={title} error={errors.title} onChange={(e) => setTitle(e.currentTarget.value)} />
      <Select label="Owner" withAsterisk data={OWNERS} value={owner} error={errors.owner} onChange={setOwner} placeholder="Pick one" />
      <MultiSelect label="Labels" data={LABELS} value={labels} onChange={setLabels} placeholder="Pick any" />
      <DatePickerInput label="Due date" withAsterisk value={due} error={errors.due} onChange={setDue} valueFormat="D MMM YYYY" placeholder="Pick a date" />
      <Switch label="Urgent" checked={urgent} onChange={(e) => setUrgent(e.currentTarget.checked)} />
      <Group>
        <Button onClick={save}>Save task</Button>
        <Button variant="default" onClick={() => { setTitle(""); setOwner(null); setLabels([]); setUrgent(false); setDue(null); setErrors({}); setResult(null); }}>Clear</Button>
      </Group>
      {result ? (
        <Alert color={result.ok ? "teal" : "red"} icon={result.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}>
          <Text size="sm">{result.text}</Text>
        </Alert>
      ) : null}
    </Stack>
  );
}
