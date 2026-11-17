import { Component } from "react";
import {
  Accordion, Avatar, BackgroundImage, Badge, Blockquote, Card, Code, ColorSwatch, DataList, Highlight, Image, Indicator, Kbd,
  List, Marquee, Mark, NumberFormatter, OverflowList, Paper, RollingNumber, SimpleGrid, Spoiler, Stack, Table, Text,
  ThemeIcon, Timeline, Title, Tree, Typography,
} from "@mantine/core";
import { IconCheck, IconStar } from "@tabler/icons-react";

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

const svg = (fill) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="${fill}"/><circle cx="120" cy="60" r="30" fill="white" opacity="0.6"/></svg>`);
const tree = [
  { value: "src", label: "src", children: [{ value: "src/app", label: "app.tsx" }, { value: "src/lib", label: "lib", children: [{ value: "src/lib/x", label: "x.ts" }] }] },
  { value: "docs", label: "docs" },
];
const tags = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu"];

export default function DataDisplayShowcase() {
  return (
    <Stack gap="md">
      <Title order={3}>Data display showcase</Title>
      <Text size="sm" c="dimmed">Typography, tables, lists, avatars, badges, images, timelines and accordions with demo data.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        <Cell name="Text Title Mark Code Kbd">
          <Title order={4}>Title</Title><Text>Text with <Mark>Mark</Mark>, <Code>Code</Code> and <Kbd>Kbd</Kbd></Text>
        </Cell>
        <Cell name="Highlight"><Highlight highlight={["demo", "data"]}>Highlight marks demo data inside a sentence.</Highlight></Cell>
        <Cell name="Blockquote"><Blockquote cite="Demo author">Blockquote body text.</Blockquote></Cell>
        <Cell name="Typography"><Typography><h4>Typography</h4><p>Styled <em>prose</em> with a <a href="#/x/sc-data-display">link</a>.</p><ul><li>One</li><li>Two</li></ul></Typography></Cell>
        <Cell name="Card Card.Section Paper">
          <Card withBorder padding="sm"><Card.Section><BackgroundImage src={svg("#4c6ef5")} h={50} /></Card.Section><Text mt="xs">Card body</Text></Card>
          <Paper withBorder p="xs" mt="xs">Paper</Paper>
        </Cell>
        <Cell name="Table Table.Thead Table.Tbody Table.Tfoot Table.Tr Table.Th Table.Td Table.Caption Table.ScrollContainer">
          <Table.ScrollContainer minWidth={260}>
            <Table striped withTableBorder>
              <Table.Caption>Table.Caption</Table.Caption>
              <Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>Count</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody><Table.Tr><Table.Td>Alpha</Table.Td><Table.Td>3</Table.Td></Table.Tr><Table.Tr><Table.Td>Beta</Table.Td><Table.Td>5</Table.Td></Table.Tr></Table.Tbody>
              <Table.Tfoot><Table.Tr><Table.Th>Total</Table.Th><Table.Th>8</Table.Th></Table.Tr></Table.Tfoot>
            </Table>
          </Table.ScrollContainer>
        </Cell>
        <Cell name="List List.Item">
          <List withPadding><List.Item>List item one</List.Item><List.Item icon={<ThemeIcon size={16} radius="xl"><IconCheck size={10} /></ThemeIcon>}>List item two</List.Item></List>
        </Cell>
        <Cell name="DataList DataList.Item DataList.ItemLabel DataList.ItemValue">
          <DataList withDivider labelWidth={90}>
            <DataList.Item><DataList.ItemLabel>Status</DataList.ItemLabel><DataList.ItemValue>Active</DataList.ItemValue></DataList.Item>
            <DataList.Item><DataList.ItemLabel>Owner</DataList.ItemLabel><DataList.ItemValue>Demo user</DataList.ItemValue></DataList.Item>
          </DataList>
        </Cell>
        <Cell name="Tree"><Tree data={tree} levelOffset={16} /></Cell>
        <Cell name="Avatar Avatar.Group">
          <Avatar.Group><Avatar src={svg("#fa5252")} /><Avatar color="blue">AB</Avatar><Avatar>+3</Avatar></Avatar.Group>
        </Cell>
        <Cell name="Badge Indicator">
          <Badge>Badge</Badge>
          <Indicator label="3" size={16} ml="md" mt="xs" inline><Avatar color="grape">IN</Avatar></Indicator>
        </Cell>
        <Cell name="Image BackgroundImage">
          <Image src={svg("#12b886")} h={70} radius="sm" alt="Image demo" />
          <BackgroundImage src={svg("#fd7e14")} h={50} radius="sm" mt="xs"><Text c="white" p="xs">BackgroundImage</Text></BackgroundImage>
        </Cell>
        <Cell name="ColorSwatch ThemeIcon">
          <ColorSwatch color="#7048e8" /><ThemeIcon ml="md"><IconStar size={16} /></ThemeIcon>
        </Cell>
        <Cell name="Timeline Timeline.Item">
          <Timeline active={1} bulletSize={18}>
            <Timeline.Item title="Created">Timeline.Item one</Timeline.Item>
            <Timeline.Item title="Reviewed">Timeline.Item two</Timeline.Item>
            <Timeline.Item title="Shipped">Timeline.Item three</Timeline.Item>
          </Timeline>
        </Cell>
        <Cell name="Accordion Accordion.Item Accordion.Control Accordion.Panel Accordion.Chevron">
          <Accordion defaultValue="a">
            <Accordion.Item value="a"><Accordion.Control>Control A</Accordion.Control><Accordion.Panel>Panel A</Accordion.Panel></Accordion.Item>
            <Accordion.Item value="b"><Accordion.Control>Control B</Accordion.Control><Accordion.Panel>Panel B</Accordion.Panel></Accordion.Item>
          </Accordion>
          <Accordion.Chevron />
        </Cell>
        <Cell name="Spoiler">
          <Spoiler maxHeight={40} showLabel="Show more" hideLabel="Hide">Spoiler text that is long enough to wrap onto several lines so the collapsed state clips it and the show more control appears. More filler text follows here to be certain of the overflow.</Spoiler>
        </Cell>
        <Cell name="Marquee">
          <Marquee pauseOnHover gap="md" duration={20000}><Badge>one</Badge><Badge>two</Badge><Badge>three</Badge></Marquee>
        </Cell>
        <Cell name="RollingNumber NumberFormatter">
          <Text>Rolling: <RollingNumber value={1234.5} thousandSeparator decimalScale={1} /></Text>
          <Text>Formatted: <NumberFormatter value={1234567.891} thousandSeparator prefix="$ " decimalScale={2} /></Text>
        </Cell>
        <Cell name="OverflowList">
          <OverflowList data={tags} gap="xs" maxRows={1} renderItem={(t) => <Badge key={t} variant="light">{t}</Badge>} renderOverflow={(items) => <Badge color="gray">+{items.length}</Badge>} />
        </Cell>
      </SimpleGrid>
    </Stack>
  );
}
