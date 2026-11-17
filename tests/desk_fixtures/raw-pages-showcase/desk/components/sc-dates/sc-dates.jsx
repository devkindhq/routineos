import { Component } from "react";
import { Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import {
  Calendar, CalendarHeader, DateInput, DatePicker, DatePickerInput, DateTimePicker, Day, DecadeLevel, DecadeLevelGroup,
  InlineDateTimePicker, LevelsGroup, MiniCalendar, Month, MonthLevel, MonthLevelGroup, MonthPicker, MonthPickerInput,
  MonthsList, PickerControl, TimeGrid, TimeInput, TimePicker, TimeValue, WeekdaysRow, YearLevel, YearLevelGroup, YearPicker,
  YearPickerInput, YearsList,
} from "@mantine/dates";

class CellBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) return <Text c="red" data-cell-failed={this.props.name}>FAILED {this.props.name}: {String(this.state.err.message)}</Text>;
    return this.props.children;
  }
}
function Cell({ name, children, tall }) {
  return (
    <Paper withBorder p="xs" data-cell={name}>
      <Text size="xs" ff="monospace" c="dimmed" mb={6}>{name}</Text>
      <CellBoundary name={name}><div style={tall ? { minHeight: tall } : undefined}>{children}</div></CellBoundary>
    </Paper>
  );
}

const D = "2026-11-17";
const times = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"];
const open = { opened: true, withinPortal: false, hideDetached: false };

export default function DatesShowcase() {
  return (
    <Stack gap="md">
      <Title order={3}>Dates showcase</Title>
      <Text size="sm" c="dimmed">All @mantine/dates exports with fixed demo dates. Inputs are shown closed except DatePickerInput.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        <Cell name="DatePicker"><DatePicker defaultDate={D} defaultValue={D} /></Cell>
        <Cell name="Calendar"><Calendar defaultDate={D} getDayProps={(d) => ({ selected: d === D })} /></Cell>
        <Cell name="MiniCalendar"><MiniCalendar defaultDate={D} value={D} numberOfDays={7} /></Cell>
        <Cell name="MonthPicker"><MonthPicker defaultDate={D} /></Cell>
        <Cell name="YearPicker"><YearPicker defaultDate={D} /></Cell>
        <Cell name="DatePickerInput" tall={380}><DatePickerInput label="DatePickerInput" defaultValue={D} popoverProps={open} /></Cell>
        <Cell name="DateInput"><DateInput label="DateInput" defaultValue={D} /></Cell>
        <Cell name="MonthPickerInput"><MonthPickerInput label="MonthPickerInput" defaultValue={D} /></Cell>
        <Cell name="YearPickerInput"><YearPickerInput label="YearPickerInput" defaultValue={D} /></Cell>
        <Cell name="DateTimePicker"><DateTimePicker label="DateTimePicker" defaultValue={D + " 09:30:00"} /></Cell>
        <Cell name="InlineDateTimePicker"><InlineDateTimePicker defaultDate={D} defaultValue={D + " 09:30:00"} /></Cell>
        <Cell name="TimePicker TimeInput TimeValue">
          <TimePicker label="TimePicker" defaultValue="09:30" withDropdown={false} />
          <TimeInput label="TimeInput" defaultValue="10:15" mt="xs" />
          <Text size="sm" mt="xs">TimeValue: <TimeValue value="14:45:00" format="12h" /></Text>
        </Cell>
        <Cell name="TimeGrid"><TimeGrid data={times} defaultValue="10:00" simpleGridProps={{ cols: 3 }} /></Cell>
        <Cell name="Day PickerControl">
          <Day date={D} selected renderDay={undefined} /> <PickerControl selected>PickerControl</PickerControl>
        </Cell>
        <Cell name="Month WeekdaysRow">
          <Month month={D} __staticSelector="Calendar" getDayProps={() => ({})} />
          <Table mt="xs"><Table.Thead><WeekdaysRow /></Table.Thead></Table>
        </Cell>
        <Cell name="MonthsList YearsList">
          <MonthsList year={D} __staticSelector="Calendar" />
          <YearsList decade="2020-01-01" __staticSelector="Calendar" />
        </Cell>
        <Cell name="CalendarHeader LevelsGroup">
          <CalendarHeader label="November 2026" __staticSelector="Calendar" />
          <LevelsGroup><Text size="sm">LevelsGroup child</Text></LevelsGroup>
        </Cell>
        <Cell name="MonthLevel MonthLevelGroup"><MonthLevel month={D} __staticSelector="Calendar" /><MonthLevelGroup month={D} numberOfColumns={1} __staticSelector="Calendar" /></Cell>
        <Cell name="YearLevel YearLevelGroup"><YearLevel year={D} __staticSelector="Calendar" /><YearLevelGroup year={D} numberOfColumns={1} __staticSelector="Calendar" /></Cell>
        <Cell name="DecadeLevel DecadeLevelGroup"><DecadeLevel decade="2020-01-01" __staticSelector="Calendar" /><DecadeLevelGroup decade="2020-01-01" numberOfColumns={1} __staticSelector="Calendar" /></Cell>
      </SimpleGrid>
    </Stack>
  );
}
