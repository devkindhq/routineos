// app/pages/Ext.jsx: #/x/<name>, a page an agent wrote (DESK_EXTENSIONS, slot page). The host draws the title and a
// back link; the component draws the body. An unknown name, or a component that fails its checks, draws an error card.
import { Anchor, Card, Stack, Text, Title } from "@mantine/core";
import { findPage } from "../../core/ext.js";
import ExtHost from "../ExtHost.jsx";

var NONE = [];
var NO_QUERY = {};

function Gone({ title, text }) {
  return (
    <Stack gap="sm">
      <Title id="page-title" order={1}>{title}</Title>
      <Card withBorder padding="md"><Text>{text}</Text></Card>
      <Anchor href="#/today">Back to Today</Anchor>
    </Stack>
  );
}

export default function Ext({ route }) {
  var name = route.params.name;
  var ext = findPage(typeof window !== "undefined" ? window.DESK_EXTENSIONS : null, name);
  if (!ext) return <Gone title="Not found" text="This page is not in this routine." />;
  var args = route.params.args || NONE;
  var query = (route.params && route.params.query) || NO_QUERY;
  return (
    <Stack gap="md">
      <Title id="page-title" order={1}>{ext.title || ext.id}</Title>
      <Anchor href="#/today" size="sm">Back to Today</Anchor>
      <ExtHost id={ext.id} props={{ args: args, params: query }}
        fallback={<Card withBorder padding="md"><Stack gap="xs"><Text>This page could not be shown. Its code failed its checks.</Text><Anchor href="#/today">Back to Today</Anchor></Stack></Card>} />
    </Stack>
  );
}
