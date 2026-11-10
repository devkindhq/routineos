// app/pages/spec/Boundary.jsx: an error boundary for a spec page and for each block on it, so a bad page or one bad
// block shows a note and leaves the rest of the Desk up. resetKey changes (a new read, another page) try again.
import { Component } from "react";

export default class Boundary extends Component {
  constructor(props) { super(props); this.state = { failed: false, key: props.resetKey }; }
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
