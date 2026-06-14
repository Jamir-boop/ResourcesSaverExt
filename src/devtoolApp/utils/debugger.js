const DEBUGGER_PROTOCOL_VERSION = '0.1';
const FRAME_FILTER = [{ type: 'iframe', exclude: false }];

const wait = (timeout) => new Promise((resolve) => setTimeout(resolve, timeout));

const chromeDebuggerCall = (methodName, ...args) =>
  new Promise((resolve, reject) => {
    chrome.debugger[methodName](...args, (result) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(result);
      }
    });
  });

const attach = (target) => chromeDebuggerCall('attach', target, DEBUGGER_PROTOCOL_VERSION);
const detach = (target) => chromeDebuggerCall('detach', target);
const sendCommand = (target, method, params) => chromeDebuggerCall('sendCommand', target, method, params);

const targetKey = (source) => `${source.tabId || ''}:${source.sessionId || 'root'}`;

export const collectDebuggerSourceMapData = async (tabId) => {
  const rootTarget = { tabId };
  const result = {
    tabId,
    attached: false,
    detached: false,
    protocolVersion: DEBUGGER_PROTOCOL_VERSION,
    scripts: [],
    sessions: [],
    errors: [],
  };

  if (!chrome.debugger) {
    result.errors.push({ phase: 'available', error: 'chrome.debugger is not available' });
    return result;
  }

  const enabledSessions = {};

  const enableSession = async (session, targetInfo) => {
    const key = targetKey(session);

    if (enabledSessions[key]) {
      return;
    }

    enabledSessions[key] = true;
    result.sessions.push({
      sessionId: session.sessionId || 'root',
      targetType: targetInfo?.type || 'page',
      targetUrl: targetInfo?.url,
    });

    try {
      await sendCommand(session, 'Debugger.enable');
    } catch (err) {
      result.errors.push({ phase: 'Debugger.enable', sessionId: session.sessionId || 'root', error: err.message });
    }

    try {
      await sendCommand(session, 'Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: FRAME_FILTER,
      });
    } catch (err) {
      result.errors.push({ phase: 'Target.setAutoAttach', sessionId: session.sessionId || 'root', error: err.message });
    }
  };

  const onEvent = (source, method, params = {}) => {
    if (source.tabId !== tabId) {
      return;
    }

    if (method === 'Debugger.scriptParsed' || method === 'Debugger.scriptFailedToParse') {
      result.scripts.push({
        method,
        sessionId: source.sessionId || 'root',
        scriptId: params.scriptId,
        url: params.url,
        sourceMapURL: params.sourceMapURL,
        hasSourceURL: params.hasSourceURL,
        isModule: params.isModule,
        targetType: source.sessionId ? 'iframe' : 'page',
      });
      return;
    }

    if (method === 'Target.attachedToTarget' && params.sessionId && params.targetInfo?.type === 'iframe') {
      const childSession = { ...source, sessionId: params.sessionId };
      enableSession(childSession, params.targetInfo).catch((err) => {
        result.errors.push({ phase: 'Target.attachedToTarget', sessionId: params.sessionId, error: err.message });
      });
    }
  };

  chrome.debugger.onEvent.addListener(onEvent);

  try {
    await attach(rootTarget);
    result.attached = true;
    await enableSession(rootTarget, { type: 'page' });
    await wait(1200);
  } catch (err) {
    result.errors.push({ phase: 'attach', error: err.message });
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    if (result.attached) {
      try {
        await detach(rootTarget);
        result.detached = true;
      } catch (err) {
        result.errors.push({ phase: 'detach', error: err.message });
      }
    }
  }

  return result;
};
