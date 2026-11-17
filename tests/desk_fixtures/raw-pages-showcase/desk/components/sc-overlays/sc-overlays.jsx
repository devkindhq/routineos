import { Component, useState } from "react";
import {
  ActionBar, Affix, Badge, Button, Dialog, Drawer, FloatingWindow, Group, HoverCard, LoadingOverlay, Menu, Menubar, Modal,
  Overlay, Paper, Popover, SimpleGrid, Stack, Text, Title, Tooltip, Tour,
} from "@mantine/core";

// Overlays render inline (withinPortal={false}) inside a relative, clipped frame so the screenshot shows them open.
// Spotlight is not exported by the registry and is therefore not shown.
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
      <CellBoundary name={name}>{tall ? <div style={{ minHeight: tall }}>{children}</div> : children}</CellBoundary>
    </Paper>
  );
}
function Frame({ children, h = 240 }) {
  return <div style={{ position: "relative", transform: "translateZ(0)", height: h, overflow: "hidden", border: "1px dashed var(--mantine-color-gray-4)", borderRadius: 6 }}>{children}</div>;
}
const inline = { root: { position: "absolute", inset: 0 }, inner: { position: "absolute", inset: 0 }, overlay: { position: "absolute", inset: 0 } };

export default function OverlaysShowcase() {
  const [bar, setBar] = useState(true);
  const [tourStep, setTourStep] = useState(0);
  return (
    <Stack gap="md">
      <Title order={3}>Overlays showcase</Title>
      <Text size="sm" c="dimmed">Modal, Drawer, Popover, Menu, Tooltip, HoverCard, Dialog, Tour and friends, shown open inside clipped frames.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <Cell name="Menubar Menubar.Menu Menubar.Target Menubar.Dropdown" tall={170}>
          <Menubar defaultOpenIndex={0}>
            <Menubar.Menu hideDetached={false} withinPortal={false}><Menubar.Target><Button variant="subtle">File</Button></Menubar.Target><Menubar.Dropdown><Menu.Item>New</Menu.Item><Menu.Item>Open</Menu.Item></Menubar.Dropdown></Menubar.Menu>
            <Menubar.Menu hideDetached={false} withinPortal={false}><Menubar.Target><Button variant="subtle">Edit</Button></Menubar.Target><Menubar.Dropdown><Menu.Item>Undo</Menu.Item></Menubar.Dropdown></Menubar.Menu>
          </Menubar>
        </Cell>
        <Cell name="Modal Modal.Root Modal.Overlay Modal.Content Modal.Header Modal.Title Modal.CloseButton Modal.Body">
          <Frame>
            <Modal opened onClose={() => {}} title="Modal" withinPortal={false} lockScroll={false} trapFocus={false} returnFocus={false} styles={inline}>Modal body</Modal>
          </Frame>
          <Frame h={200}>
            <Modal.Root opened onClose={() => {}} withinPortal={false} lockScroll={false} trapFocus={false} returnFocus={false} styles={inline}>
              <Modal.Overlay />
              <Modal.Content>
                <Modal.Header><Modal.Title>Modal.Title</Modal.Title><Modal.CloseButton /></Modal.Header>
                <Modal.Body>Modal.Body</Modal.Body>
              </Modal.Content>
            </Modal.Root>
          </Frame>
        </Cell>
        <Cell name="Drawer Drawer.Root Drawer.Overlay Drawer.Content Drawer.Header Drawer.Title Drawer.CloseButton Drawer.Body">
          <Frame>
            <Drawer opened onClose={() => {}} title="Drawer" withinPortal={false} lockScroll={false} trapFocus={false} returnFocus={false} styles={inline}>Drawer body</Drawer>
          </Frame>
          <Frame h={200}>
            <Drawer.Root opened onClose={() => {}} withinPortal={false} lockScroll={false} trapFocus={false} returnFocus={false} position="bottom" styles={inline}>
              <Drawer.Overlay />
              <Drawer.Content>
                <Drawer.Header><Drawer.Title>Drawer.Title</Drawer.Title><Drawer.CloseButton /></Drawer.Header>
                <Drawer.Body>Drawer.Body</Drawer.Body>
              </Drawer.Content>
            </Drawer.Root>
          </Frame>
        </Cell>
        <Cell name="Popover Popover.Target Popover.Dropdown" tall={140}>
          <Popover opened hideDetached={false} withinPortal={false} position="bottom-start" withArrow>
            <Popover.Target><Button variant="default">Popover target</Button></Popover.Target>
            <Popover.Dropdown><Text size="sm">Popover.Dropdown</Text></Popover.Dropdown>
          </Popover>
        </Cell>
        <Cell name="Popover.ContextMenu" tall={90}>
          <Popover hideDetached={false} withinPortal={false}>
            <Popover.ContextMenu><Paper withBorder p="md">Right click or long press here</Paper></Popover.ContextMenu>
            <Popover.Dropdown>Context popover</Popover.Dropdown>
          </Popover>
        </Cell>
        <Cell name="Menu Menu.Target Menu.Dropdown Menu.Item Menu.Label Menu.Divider Menu.Sub Menu.Sub.Target Menu.Sub.Dropdown Menu.Sub.Item" tall={260}>
          <Menu opened hideDetached={false} withinPortal={false}>
            <Menu.Target><Button variant="default">Menu target</Button></Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Menu.Label</Menu.Label>
              <Menu.Item>Menu.Item</Menu.Item>
              <Menu.Divider />
              <Menu.Sub opened hideDetached={false} withinPortal={false}>
                <Menu.Sub.Target><Menu.Sub.Item>Menu.Sub</Menu.Sub.Item></Menu.Sub.Target>
                <Menu.Sub.Dropdown><Menu.Item>Sub item</Menu.Item></Menu.Sub.Dropdown>
              </Menu.Sub>
            </Menu.Dropdown>
          </Menu>
        </Cell>
        <Cell name="Menu.CheckboxItem Menu.CheckboxGroup Menu.RadioGroup Menu.RadioItem Menu.Search" tall={300}>
          <Menu opened hideDetached={false} withinPortal={false}>
            <Menu.Target><Button variant="default">Choice menu</Button></Menu.Target>
            <Menu.Dropdown>
              <Menu.Search placeholder="Menu.Search" />
              <Menu.CheckboxItem defaultChecked>Menu.CheckboxItem</Menu.CheckboxItem>
              <Menu.CheckboxGroup defaultValue={["a"]}>
                <Menu.CheckboxItem value="a">Group A</Menu.CheckboxItem>
                <Menu.CheckboxItem value="b">Group B</Menu.CheckboxItem>
              </Menu.CheckboxGroup>
              <Menu.RadioGroup defaultValue="x">
                <Menu.RadioItem value="x">Radio X</Menu.RadioItem>
                <Menu.RadioItem value="y">Radio Y</Menu.RadioItem>
              </Menu.RadioGroup>
            </Menu.Dropdown>
          </Menu>
        </Cell>
        <Cell name="Menu.ContextMenu" tall={90}>
          <Menu hideDetached={false} withinPortal={false}>
            <Menu.ContextMenu><Paper withBorder p="md">Right click or long press here</Paper></Menu.ContextMenu>
            <Menu.Dropdown><Menu.Item>Context item</Menu.Item></Menu.Dropdown>
          </Menu>
        </Cell>
        <Cell name="Tooltip" tall={90}>
          <Tooltip label="Tooltip" opened hideDetached={false} withinPortal={false} position="bottom"><Button variant="default">Tooltip target</Button></Tooltip>
        </Cell>
        <Cell name="Tooltip.Floating Tooltip.Group" tall={90}>
          <Group>
            <Tooltip.Floating label="Tooltip.Floating (follows the cursor)"><Badge>Hover for floating</Badge></Tooltip.Floating>
            <Tooltip.Group openDelay={100} closeDelay={100}>
              <Tooltip label="One"><Badge>Group one</Badge></Tooltip>
              <Tooltip label="Two"><Badge>Group two</Badge></Tooltip>
            </Tooltip.Group>
          </Group>
        </Cell>
        <Cell name="HoverCard HoverCard.Target HoverCard.Dropdown" tall={130}>
          <HoverCard initiallyOpened hideDetached={false} withinPortal={false} position="bottom-start">
            <HoverCard.Target><Button variant="default">HoverCard target</Button></HoverCard.Target>
            <HoverCard.Dropdown><Text size="sm">HoverCard.Dropdown</Text></HoverCard.Dropdown>
          </HoverCard>
        </Cell>
        <Cell name="HoverCard.Group">
          <HoverCard.Group openDelay={100} closeDelay={100}>
            <Group>
              <HoverCard hideDetached={false} withinPortal={false}><HoverCard.Target><Badge>Card one</Badge></HoverCard.Target><HoverCard.Dropdown>One</HoverCard.Dropdown></HoverCard>
              <HoverCard hideDetached={false} withinPortal={false}><HoverCard.Target><Badge>Card two</Badge></HoverCard.Target><HoverCard.Dropdown>Two</HoverCard.Dropdown></HoverCard>
            </Group>
          </HoverCard.Group>
        </Cell>
        <Cell name="Dialog">
          <Frame h={150}>
            <Dialog opened withCloseButton onClose={() => {}} withinPortal={false} style={{ position: "absolute" }} position={{ bottom: 8, left: 8 }}>Dialog content</Dialog>
          </Frame>
        </Cell>
        <Cell name="Affix">
          <Frame h={120}>
            <Affix withinPortal={false} position={{ bottom: 8, right: 8 }} style={{ position: "absolute" }}><Button size="xs">Affix</Button></Affix>
          </Frame>
        </Cell>
        <Cell name="Overlay LoadingOverlay">
          <Group grow align="flex-start">
            <div style={{ position: "relative", height: 110 }}><Text p="xs">Overlay base content</Text><Overlay color="#000" backgroundOpacity={0.35} blur={2} /></div>
            <div style={{ position: "relative", height: 110 }}><Text p="xs">LoadingOverlay base content</Text><LoadingOverlay visible overlayProps={{ radius: "sm", blur: 2 }} /></div>
          </Group>
        </Cell>
        <Cell name="ActionBar ActionBar.CloseButton ActionBar.Divider">
          <Frame h={120}>
            <Button size="xs" m="xs" onClick={() => setBar(true)}>Show ActionBar</Button>
            <ActionBar opened={bar} onClose={() => setBar(false)} style={{ position: "absolute" }}>
              <Button size="xs" variant="default">Archive</Button>
              <ActionBar.Divider />
              <ActionBar.CloseButton />
            </ActionBar>
          </Frame>
        </Cell>
        <Cell name="FloatingWindow">
          <Frame h={150}>
            <FloatingWindow withinPortal={false} dimensions={{ width: 220, height: 100 }}><Text size="sm" p="xs">FloatingWindow content</Text></FloatingWindow>
          </Frame>
        </Cell>
        <Cell name="Tour Tour.Step" tall={220}>
          <Group>
            <Button id="tour-target-a" variant="default" size="xs" onClick={() => setTourStep(0)}>Tour target A</Button>
            <Button id="tour-target-b" variant="default" size="xs" onClick={() => setTourStep(1)}>Tour target B</Button>
          </Group>
          <Tour active step={tourStep} onStepChange={setTourStep} onClose={() => {}} withOverlay={false} withinPortal={false} withKeyboardNavigation={false}>
            <Tour.Step target="#tour-target-a" title="Step one">First step</Tour.Step>
            <Tour.Step target="#tour-target-b" title="Step two">Second step</Tour.Step>
          </Tour>
        </Cell>
      </SimpleGrid>
    </Stack>
  );
}
