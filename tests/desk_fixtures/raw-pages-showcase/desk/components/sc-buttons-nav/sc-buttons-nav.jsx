import { Component, useEffect, useRef, useState } from "react";
import {
  ActionIcon, Anchor, Breadcrumbs, Burger, Button, CloseButton, CloseIcon, CopyButton, FloatingIndicator, Group, NavLink,
  Pagination, Paper, Scroller, SimpleGrid, Stack, Stepper, Tabs, TableOfContents, Text, Title, Toggle, Toolbar,
  UnstyledButton,
} from "@mantine/core";
import { IconBell, IconHeart, IconHome, IconSettings, IconStar } from "@tabler/icons-react";

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

function IndicatorDemo() {
  const [root, setRoot] = useState(null);
  const refs = useRef({});
  const [active, setActive] = useState(0);
  const [target, setTarget] = useState(null);
  useEffect(() => { setTarget(refs.current[active] || null); }, [active, root]);
  const labels = ["React", "Vue", "Svelte"];
  return (
    <div ref={setRoot} style={{ position: "relative", display: "inline-flex", gap: 8, padding: 4 }}>
      <FloatingIndicator target={target} parent={root} style={{ background: "var(--mantine-color-blue-1)", borderRadius: 6 }} />
      {labels.map((l, i) => (
        <UnstyledButton key={l} ref={(el) => { refs.current[i] = el; }} onClick={() => setActive(i)} px="sm" py={4} style={{ position: "relative", zIndex: 1 }}>
          <Text size="sm">{l}</Text>
        </UnstyledButton>
      ))}
    </div>
  );
}

export default function ButtonsNavShowcase() {
  const [opened, setOpened] = useState(false);
  const [page, setPage] = useState(3);
  const [step, setStep] = useState(3);
  const [bold, setBold] = useState("single-a");
  return (
    <Stack gap="md">
      <Title order={3}>Buttons and navigation showcase</Title>
      <Text size="sm" c="dimmed">Buttons, links, steppers, pagination, tabs, toolbars and the other navigation components.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        <Cell name="Button Button.Group Button.GroupSection">
          <Button>Button</Button>
          <Button.Group mt="xs"><Button variant="default">One</Button><Button.GroupSection variant="default" bg="var(--mantine-color-body)" px="xs">Section</Button.GroupSection><Button variant="default">Two</Button></Button.Group>
        </Cell>
        <Cell name="ActionIcon ActionIcon.Group ActionIcon.GroupSection">
          <Group><ActionIcon aria-label="ActionIcon"><IconHeart size={16} /></ActionIcon></Group>
          <ActionIcon.Group mt="xs"><ActionIcon variant="default" aria-label="one"><IconStar size={16} /></ActionIcon><ActionIcon.GroupSection variant="default" bg="var(--mantine-color-body)" px="xs">Section</ActionIcon.GroupSection><ActionIcon variant="default" aria-label="two"><IconBell size={16} /></ActionIcon></ActionIcon.Group>
        </Cell>
        <Cell name="UnstyledButton Anchor CloseButton CloseIcon Burger">
          <Group>
            <UnstyledButton>UnstyledButton</UnstyledButton>
            <Anchor href="#/x/sc-buttons-nav">Anchor</Anchor>
            <CloseButton aria-label="CloseButton" />
            <CloseIcon size={14} />
            <Burger opened={opened} onClick={() => setOpened((o) => !o)} aria-label="Burger" />
          </Group>
        </Cell>
        <Cell name="CopyButton">
          <CopyButton value="demo text">{({ copied, copy }) => <Button size="xs" variant="light" onClick={copy}>{copied ? "Copied" : "CopyButton"}</Button>}</CopyButton>
        </Cell>
        <Cell name="Breadcrumbs">
          <Breadcrumbs><Anchor href="#/x/sc-buttons-nav">Home</Anchor><Anchor href="#/x/sc-buttons-nav">Section</Anchor><Text size="sm">Page</Text></Breadcrumbs>
        </Cell>
        <Cell name="NavLink">
          <NavLink label="NavLink" leftSection={<IconHome size={16} />} active />
          <NavLink label="With children" leftSection={<IconSettings size={16} />} defaultOpened><NavLink label="Child" /></NavLink>
        </Cell>
        <Cell name="Pagination Pagination.Root Pagination.Control Pagination.Dots Pagination.First Pagination.Last Pagination.Next Pagination.Previous Pagination.Items Pagination.Label">
          <Pagination total={10} value={page} onChange={setPage} />
          <Pagination.Root total={20} value={page} onChange={setPage} mt="xs">
            <Group gap={4}>
              <Pagination.First /><Pagination.Previous /><Pagination.Items /><Pagination.Dots /><Pagination.Control>Control</Pagination.Control><Pagination.Next /><Pagination.Last />
            </Group>
          </Pagination.Root>
          <Pagination.Root total={20} value={page} onChange={setPage} mt="xs"><Pagination.Label>Pagination.Label: page {page}</Pagination.Label></Pagination.Root>
        </Cell>
        <Cell name="Tabs Tabs.List Tabs.Tab Tabs.Panel">
          <Tabs defaultValue="a"><Tabs.List><Tabs.Tab value="a">Tab A</Tabs.Tab><Tabs.Tab value="b">Tab B</Tabs.Tab></Tabs.List><Tabs.Panel value="a" pt="xs">Panel A</Tabs.Panel><Tabs.Panel value="b" pt="xs">Panel B</Tabs.Panel></Tabs>
        </Cell>
        <Cell name="Stepper Stepper.Step Stepper.Completed">
          <Stepper active={step} onStepClick={setStep} size="xs">
            <Stepper.Step label="One" description="Start" />
            <Stepper.Step label="Two" description="Middle" />
            <Stepper.Step label="Three" description="End" />
            <Stepper.Completed><Text size="sm">Stepper.Completed: all steps done</Text></Stepper.Completed>
          </Stepper>
        </Cell>
        <Cell name="Toolbar Toolbar.Group Toolbar.Toggle Toolbar.ToggleGroup Toolbar.ToggleItem Toolbar.Divider">
          <Toolbar withBorder aria-label="Toolbar">
            <Toolbar.Group><Toolbar.Toggle>Bold</Toolbar.Toggle></Toolbar.Group>
            <Toolbar.Divider />
            <Toolbar.ToggleGroup type="single" value={bold} onChange={setBold}>
              <Toolbar.ToggleItem value="single-a">A</Toolbar.ToggleItem>
              <Toolbar.ToggleItem value="single-b">B</Toolbar.ToggleItem>
            </Toolbar.ToggleGroup>
          </Toolbar>
        </Cell>
        <Cell name="Toggle"><Toggle defaultActive aria-label="Toggle">Toggle</Toggle></Cell>
        <Cell name="FloatingIndicator"><IndicatorDemo /></Cell>
        <Cell name="Scroller">
          <Scroller>
            <Group wrap="nowrap" gap="xs">{Array.from({ length: 14 }, (_, i) => <Button key={i} variant="default" size="xs">Item {i + 1}</Button>)}</Group>
          </Scroller>
        </Cell>
        <Cell name="TableOfContents">
          <div id="sc-toc-source" style={{ display: "none" }}><h2 id="sc-toc-a">First heading</h2><h2 id="sc-toc-b">Second heading</h2></div>
          <TableOfContents scrollSpyOptions={{ selector: "#sc-toc-source :is(h2)" }}
            initialData={[
              { id: "sc-toc-a", value: "First heading", depth: 1, getNode: () => document.getElementById("sc-toc-a") },
              { id: "sc-toc-b", value: "Second heading", depth: 1, getNode: () => document.getElementById("sc-toc-b") },
            ]} />
        </Cell>
      </SimpleGrid>
    </Stack>
  );
}
