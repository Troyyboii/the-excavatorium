import { Window } from "happy-dom";

const testWindow = new Window({ url: "http://localhost/" });
type TestGlobals = {
  window: Window;
  document: Window["document"];
  navigator: Window["navigator"];
  HTMLElement: Window["HTMLElement"];
  HTMLInputElement: Window["HTMLInputElement"];
  Node: Window["Node"];
  NodeFilter: Window["NodeFilter"];
  Event: Window["Event"];
  CustomEvent: Window["CustomEvent"];
  MouseEvent: Window["MouseEvent"];
  KeyboardEvent: Window["KeyboardEvent"];
  FocusEvent: Window["FocusEvent"];
  PointerEvent: Window["PointerEvent"];
  MutationObserver: Window["MutationObserver"];
  ResizeObserver: Window["ResizeObserver"];
  getComputedStyle: Window["getComputedStyle"];
  requestAnimationFrame: Window["requestAnimationFrame"];
  cancelAnimationFrame: Window["cancelAnimationFrame"];
};

const testGlobals = globalThis as unknown as TestGlobals;

testGlobals.window = testWindow;
testGlobals.document = testWindow.document;
testGlobals.navigator = testWindow.navigator;
testGlobals.HTMLElement = testWindow.HTMLElement;
testGlobals.HTMLInputElement = testWindow.HTMLInputElement;
testGlobals.Node = testWindow.Node;
testGlobals.NodeFilter = testWindow.NodeFilter;
testGlobals.Event = testWindow.Event;
testGlobals.CustomEvent = testWindow.CustomEvent;
testGlobals.MouseEvent = testWindow.MouseEvent;
testGlobals.KeyboardEvent = testWindow.KeyboardEvent;
testGlobals.FocusEvent = testWindow.FocusEvent;
testGlobals.PointerEvent = testWindow.PointerEvent;
testGlobals.MutationObserver = testWindow.MutationObserver;
testGlobals.ResizeObserver = testWindow.ResizeObserver;
testGlobals.getComputedStyle = testWindow.getComputedStyle.bind(testWindow);
testGlobals.requestAnimationFrame = testWindow.requestAnimationFrame.bind(testWindow);
testGlobals.cancelAnimationFrame = testWindow.cancelAnimationFrame.bind(testWindow);
