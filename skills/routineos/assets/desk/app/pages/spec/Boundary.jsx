// app/pages/spec/Boundary.jsx: an error boundary for a spec page and for each block on it, so a bad page or one bad
// block shows a note and leaves the rest of the Desk up. resetKey changes (a new read, another page) try again. A raw page
// (RawPageHost.jsx) uses it too.
import { Component } from "react";

export default class Boundary extends Component {
  constructor(props) { super(props); this.state = { failed: false, key: props.resetKey }; }
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }
  // onError (optional) hears each caught error once, after the fallback is drawn.
  componentDidCatch(error) { if (typeof this.props.onError === "function") this.props.onError(error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
