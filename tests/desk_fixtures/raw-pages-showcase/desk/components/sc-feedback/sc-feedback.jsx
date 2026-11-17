import { Component, useState } from "react";
import {
  Alert, AppShell, AspectRatio, Box, Button, Center, Collapse, Container, Divider, EmptyState, FloatingArrow, FocusTrap, Flex,
  Grid, Group, Loader, Notification, Paper, Progress, RingProgress, ScrollArea, SemiCircleProgress, SimpleGrid, Skeleton,
  Space, Splitter, Stack, Text, Title, Transition, VisuallyHidden,
} from "@mantine/core";
import { IconInfoCircle, IconInbox } from "@tabler/icons-react";

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
const box = { background: "var(--mantine-color-blue-1)", padding: 6, borderRadius: 4, fontSize: 12 };

export default function FeedbackShowcase() {
  const [open, setOpen] = useState(true);
  return (
    <Stack gap="md">
      <Title order={3}>Feedback and layout showcase</Title>
      <Text size="sm" c="dimmed">Progress, loaders, alerts, empty states, transitions and the layout primitives.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        <Cell name="Progress Progress.Root Progress.Section Progress.Label">
          <Progress value={60} striped animated />
          <Progress.Root size="lg" mt="xs"><Progress.Section value={40} color="teal"><Progress.Label>Progress.Label</Progress.Label></Progress.Section><Progress.Section value={20} color="orange" /></Progress.Root>
        </Cell>
        <Cell name="RingProgress SemiCircleProgress">
          <Group>
            <RingProgress size={90} thickness={10} sections={[{ value: 40, color: "blue" }, { value: 25, color: "teal" }]} label={<Text size="xs" ta="center">40</Text>} />
            <SemiCircleProgress value={65} size={140} label="65%" />
          </Group>
        </Cell>
        <Cell name="Loader Skeleton">
          <Group><Loader size="sm" /><Loader type="bars" size="sm" /><Loader type="dots" size="sm" /></Group>
          <Skeleton height={14} mt="xs" /><Skeleton height={14} mt={6} width="70%" /><Skeleton height={36} circle mt={6} />
        </Cell>
        <Cell name="Alert"><Alert icon={<IconInfoCircle size={16} />} title="Alert title" withCloseButton>Alert body text.</Alert></Cell>
        <Cell name="Notification"><Notification title="Notification title" withBorder>Notification body text.</Notification></Cell>
        <Cell name="EmptyState EmptyState.Indicator EmptyState.Title EmptyState.Description EmptyState.Actions">
          <EmptyState title="EmptyState" description="Nothing here yet." icon={<IconInbox size={22} />}><Button size="xs">Add item</Button></EmptyState>
          <EmptyState mt="xs">
            <EmptyState.Indicator><IconInbox size={20} /></EmptyState.Indicator>
            <EmptyState.Title>EmptyState.Title</EmptyState.Title>
            <EmptyState.Description>EmptyState.Description</EmptyState.Description>
            <EmptyState.Actions><Button size="xs" variant="default">EmptyState.Actions</Button></EmptyState.Actions>
          </EmptyState>
        </Cell>
        <Cell name="Transition Collapse">
          <Button size="xs" onClick={() => setOpen((o) => !o)}>Toggle</Button>
          <Transition mounted={open} transition="fade" duration={200}>{(styles) => <div style={{ ...styles, ...box, marginTop: 6 }}>Transition</div>}</Transition>
          <Collapse expanded={open}><div style={{ ...box, marginTop: 6 }}>Collapse</div></Collapse>
        </Cell>
        <Cell name="Box Center Container Space Divider">
          <Box style={box}>Box</Box>
          <Center h={40} style={box}>Center</Center>
          <Container size="xs" style={box} my={4}>Container</Container>
          <Space h="xs" />
          <Divider label="Divider" />
        </Cell>
        <Cell name="Flex Group Stack SimpleGrid">
          <Flex gap="xs" mb="xs"><div style={box}>Flex</div><div style={box}>Flex</div></Flex>
          <Group mb="xs"><div style={box}>Group</div><div style={box}>Group</div></Group>
          <Stack gap={4} mb="xs"><div style={box}>Stack</div><div style={box}>Stack</div></Stack>
          <SimpleGrid cols={2}><div style={box}>SimpleGrid</div><div style={box}>SimpleGrid</div></SimpleGrid>
        </Cell>
        <Cell name="Grid Grid.Col">
          <Grid><Grid.Col span={4}><div style={box}>Grid.Col 4</div></Grid.Col><Grid.Col span={8}><div style={box}>Grid.Col 8</div></Grid.Col></Grid>
        </Cell>
        <Cell name="AspectRatio"><AspectRatio ratio={16 / 9} maw={240}><div style={{ ...box, display: "grid", placeItems: "center" }}>AspectRatio 16:9</div></AspectRatio></Cell>
        <Cell name="ScrollArea ScrollArea.Autosize">
          <ScrollArea h={70} type="always"><div style={{ width: 500, ...box }}>ScrollArea content that is wider than its container so a scrollbar shows.</div></ScrollArea>
          <ScrollArea.Autosize mah={50} mt="xs"><div style={{ height: 120, ...box }}>ScrollArea.Autosize</div></ScrollArea.Autosize>
        </Cell>
        <Cell name="Splitter Splitter.Pane">
          <div style={{ height: 90 }}>
            <Splitter>
              <Splitter.Pane defaultSize={50}><div style={box}>Pane A</div></Splitter.Pane>
              <Splitter.Pane defaultSize={50}><div style={box}>Pane B</div></Splitter.Pane>
            </Splitter>
          </div>
        </Cell>
        <Cell name="FocusTrap FocusTrap.InitialFocus VisuallyHidden FloatingArrow">
          <FocusTrap active={false}><div style={box}>FocusTrap (inactive)<FocusTrap.InitialFocus /></div></FocusTrap>
          <VisuallyHidden>VisuallyHidden text</VisuallyHidden>
          <div style={{ position: "relative", height: 40, marginTop: 6 }}>
            <div style={{ ...box, position: "absolute", top: 0, left: 0, right: 0, bottom: 10 }}>FloatingArrow below</div>
            <FloatingArrow position="bottom" arrowX={20} arrowY={0} arrowSize={8} arrowOffset={5} arrowRadius={1} style={{ position: "absolute", bottom: 2 }} />
          </div>
        </Cell>
        <Cell name="AppShell AppShell.Header AppShell.Navbar AppShell.Main AppShell.Aside AppShell.Footer AppShell.Section">
          <div style={{ position: "relative", transform: "translateZ(0)", height: 260, overflow: "hidden", border: "1px dashed var(--mantine-color-gray-4)" }}>
            <AppShell header={{ height: 36 }} footer={{ height: 30 }} navbar={{ width: 90, breakpoint: "xs", collapsed: { mobile: false } }} aside={{ width: 80, breakpoint: "md", collapsed: { desktop: false, mobile: true } }} padding="xs" style={{ minHeight: 0 }}>
              <AppShell.Header><Text size="xs" p="xs">Header</Text></AppShell.Header>
              <AppShell.Navbar p="xs"><AppShell.Section><Text size="xs">Navbar</Text></AppShell.Section><AppShell.Section grow><Text size="xs">Section</Text></AppShell.Section></AppShell.Navbar>
              <AppShell.Main><Text size="xs">Main</Text></AppShell.Main>
              <AppShell.Aside p="xs"><Text size="xs">Aside</Text></AppShell.Aside>
              <AppShell.Footer><Text size="xs" p="xs">Footer</Text></AppShell.Footer>
            </AppShell>
          </div>
        </Cell>
      </SimpleGrid>
    </Stack>
  );
}
