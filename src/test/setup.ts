import { Window } from "happy-dom";

const testWindow = new Window({ url: "http://localhost/" });
type TestGlobals = {
  window: Window;
  document: Window["document"];
  navigator: Window["navigator"];
  HTMLElement: Window["HTMLElement"];
  Node: Window["Node"];
  Event: Window["Event"];
  MouseEvent: Window["MouseEvent"];
  KeyboardEvent: Window["KeyboardEvent"];
  FocusEvent: Window["FocusEvent"];
  PointerEvent: Window["PointerEvent"];
  getComputedStyle: Window["getComputedStyle"];
  requestAnimationFrame: Window["requestAnimationFrame"];
  cancelAnimationFrame: Window["cancelAnimationFrame"];
};

const testGlobals = globalThis as unknown as TestGlobals;

testGlobals.window = testWindow;
testGlobals.document = testWindow.document;
testGlobals.navigator = testWindow.navigator;
testGlobals.HTMLElement = testWindow.HTMLElement;
testGlobals.Node = testWindow.Node;
testGlobals.Event = testWindow.Event;
testGlobals.MouseEvent = testWindow.MouseEvent;
testGlobals.KeyboardEvent = testWindow.KeyboardEvent;
testGlobals.FocusEvent = testWindow.FocusEvent;
testGlobals.PointerEvent = testWindow.PointerEvent;
testGlobals.getComputedStyle = testWindow.getComputedStyle.bind(testWindow);
testGlobals.requestAnimationFrame = testWindow.requestAnimationFrame.bind(testWindow);
testGlobals.cancelAnimationFrame = testWindow.cancelAnimationFrame.bind(testWindow);
