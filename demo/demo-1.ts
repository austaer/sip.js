/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable no-console */
import { Invitation } from "../lib/api/invitation.js";
import { Inviter } from "../lib/api/inviter.js";
import { RegistererRegisterOptions } from "../lib/api/registerer-register-options.js";
import { RegistererState } from "../lib/api/registerer-state.js";
import { Registerer } from "../lib/api/registerer.js";
import { SessionState } from "../lib/api/session-state.js";
import { Session } from "../lib/api/session.js";
import { UserAgentOptions } from "../lib/api/user-agent-options.js";
import { UserAgent } from "../lib/api/user-agent.js";
import { IncomingResponse } from "../lib/core/messages/incoming-response.js";
import { PrackableIncomingResponseWithSession } from "../lib/core/messages/methods/invite.js";
import { holdModifier, SessionDescriptionHandler, SimpleUser } from "../lib/platform/web/index.js";
import { getAudio, getButton, getButtons, getDiv, getInput, getSelect, getSpan } from "./demo-utils.js";

const serverSpan = getSpan("server");
const targetSpan = getSpan("target");
const connectButton = getButton("connect");
const callButton = getButton("call");
const hangupButton = getButton("hangup");
const disconnectButton = getButton("disconnect");
const audioElement = getAudio("remoteAudio");
const keypad = getButtons("keypad");
const dtmfSpan = getSpan("dtmf");
const holdButton = getButton("hold");
const muteCheckbox = getInput("mute");
let domainName = getSelect("domainName").value.trim();

// WebSocket Server URL

// Destination URI
const targetEl: HTMLInputElement | null = document.querySelector("#target-input");

// Name for demo user
const holdSession: Map<string, Session> = new Map();
const sessions: Map<string, Session> = new Map();
let activatedSessionId = "";

const forcePCMU = (sessionDescription: RTCSessionDescriptionInit) => {
  const { type } = sessionDescription;
  let { sdp } = sessionDescription;
  const payloadsToRemove = ["9", "111"];

  // Logic to reorder or remove codecs in the SDP string
  // (This often involves string manipulation or a dedicated SDP manipulation library)
  console.debug("Original SDP:", sdp);
  if (typeof sdp !== "string") return Promise.reject();
  const sdpLines = sdp.split("\r\n");

  const mLineIndex = sdpLines.findIndex((l) => l.startsWith("m=audio"));
  if (mLineIndex === -1) Promise.resolve({ sdp, type });

  const parts = sdpLines[mLineIndex].split(" ");
  const header = parts.slice(0, 3);
  const payloads = parts.slice(3);

  const filteredPayloads = payloads.filter((p) => !payloadsToRemove.includes(p));

  if (filteredPayloads.length === 0) {
    return Promise.resolve({ sdp, type });
  }

  sdpLines[mLineIndex] = [...header, ...filteredPayloads].join(" ");

  const removeSet = new Set(payloadsToRemove);

  const newLines = sdpLines.filter((line) => {
    if (line.startsWith("a=rtpmap:") || line.startsWith("a=fmtp:") || line.startsWith("a=rtcp-fb:")) {
      const payload = line.split(":")[1].split(" ")[0];
      return !removeSet.has(payload);
    }
    return true;
  });
  sdp = newLines.join("\r\n");
  console.debug("Modified SDP:", sdp);
  return Promise.resolve({ sdp, type });
};

const acceptInvitation = async () => {
  await (sessions.get(activatedSessionId) as Invitation).accept();
  getSpan("call-status").innerHTML = "Answered";
};
const rejectInvitation = async () => {
  await (sessions.get(activatedSessionId) as Invitation).reject();
  getSpan("call-status").innerHTML = "Idle";
};
const blindTransfer = async () => {
  const domainName = getSelect("domainName").value.trim();
  const target = UserAgent.makeURI(`sip:${targetEl?.value}@${domainName}`);
  const session = sessions.get(activatedSessionId);
  if (target && session) {
    await session.refer(target);
  }
};

const attendedTransfer = async () => {
  return null;
};

const consult = async () => {
  const target = targetEl?.value ?? "N/a";
  const domainName = getSelect("domainName").value.trim();
  targetSpan.innerHTML = target;
  if (userAgent.isConnected()) {
    const uri = UserAgent.makeURI(`sip:${target}@${domainName}`);
    if (uri) {
      const session = new Inviter(userAgent, uri, { earlyMedia: true });
      session.stateChange.addListener((state: SessionState) => {
        if (state === SessionState.Established) {
          console.log("Speaking with Colleague B. Caller A is still on hold.");
        }
      });
      await session.invite();
    }
  }
};

const onCallStart = (sessionId?: string) => {
  getButton("consult").addEventListener("click", consult);
  getButton("attended-transfer").addEventListener("click", attendedTransfer);
  getButton("blind-transfer").addEventListener("click", blindTransfer);
  callButton.disabled = true;
  hangupButton.disabled = false;
  keypadDisabled(false);
  holdDisabled(false);
  muteCheckboxDisabled(false);
  activatedSessionId = sessionId ?? activatedSessionId;
  const session = sessions.get(activatedSessionId);
  if (session) {
    setupRemoteMedia(session);
  }
};

const onCallEnd = () => {
  callButton.disabled = false;
  hangupButton.disabled = true;
  keypadDisabled(true);
  holdDisabled(true);
  muteCheckboxDisabled(true);
  cleanupMedia();
};

const onSessionStateChange = (state: SessionState) => {
  switch (state) {
    case SessionState.Initial:
      getSpan("call-status").innerHTML = "Ringing";
      break;
    case SessionState.Establishing:
    case SessionState.Established:
      onCallStart();
      break;
    case SessionState.Terminating:
    case SessionState.Terminated:
      getButton("consult").removeEventListener("click", consult);
      getButton("accept").removeEventListener("click", acceptInvitation);
      getButton("reject").removeEventListener("click", rejectInvitation);
      getButton("attended-transfer").removeEventListener("click", attendedTransfer);
      getButton("blind-transfer").removeEventListener("click", blindTransfer);
      getSpan("call-status").innerHTML = "Idle";
      onCallEnd();
      sessions.delete(activatedSessionId);
      break;
    default:
      throw new Error("Unknown session state.");
  }
};

const makeCall = async () => {
  const target = targetEl?.value ?? "N/a";
  targetSpan.innerHTML = target;
  if (userAgent.isConnected()) {
    try {
      const uri = UserAgent.makeURI(`sip:${target}@${domainName}`);
      if (uri) {
        const inviter = new Inviter(userAgent, uri, { earlyMedia: true });
        await inviter.invite({
          sessionDescriptionHandlerModifiers: [forcePCMU],
          withoutSdp: false,
          requestDelegate: {
            onAccept(response) {
              onCallStart();
            },
            onProgress(response) {
              onCallStart();
            },
            onReject(response) {
              onCallEnd();
              sessions.delete(activatedSessionId);
            }
          }
        });
        sessions.set(inviter.id, inviter);
        activatedSessionId = inviter.id;
        inviter.stateChange.addListener(onSessionStateChange);
      }
    } catch (error) {
      callButton.disabled = false;
      hangupButton.disabled = true;
      alert("Failed to call.\n" + error);
    }
  }
};

const initUserAgent = () => {
  const usernameInput = getInput("username");
  const authorizationUsername = usernameInput.value.trim();
  domainName = getSelect("domainName").value.trim();
  const authorizationPassword = getInput("password").value;
  const contactName = getInput("contactName")?.value ?? "";
  const host = getSelect("host").value;
  const port = getInput("port")?.value ?? "5066";

  const transportOptions: UserAgentOptions = {
    uri: UserAgent.makeURI(`sip:${authorizationUsername}@${domainName}`),
    authorizationUsername,
    authorizationPassword,
    contactName,
    displayName: contactName,
    transportOptions: {
      server: `ws://${host}:${port}`,
      connectionTimeout: 5000,
      keepAliveInterval: 30,
      keepAliveDebounce: 10,
      traceSip: false
    },
    delegate: {
      onInvite(invitation) {
        sessions.set(invitation.id, invitation);
        activatedSessionId = invitation.id;
        if (invitation.state == SessionState.Initial) {
          getSpan("call-status").innerHTML = "Ringing";
        }
        invitation.stateChange.addListener(onSessionStateChange);
        getButton("accept").addEventListener("click", acceptInvitation);
        getButton("reject").addEventListener("click", rejectInvitation);
        onCallStart();
      },
      onDisconnect() {
        sessions.delete(activatedSessionId);
        activatedSessionId = "";
        onCallEnd();
      }
    }
  };

  userAgent = new UserAgent(transportOptions);
};

const remoteStream = new MediaStream();
function setupRemoteMedia(session: Session) {
  if (session.state === SessionState.Established && audioElement.srcObject == null) {
    const sdh = session.sessionDescriptionHandler as SessionDescriptionHandler;
    sdh.peerConnection!.getReceivers().forEach((receiver) => {
      if (receiver.track) {
        remoteStream.addTrack(receiver.track);
      }
    });
    audioElement.srcObject = remoteStream;
    audioElement.play();
  }
}

function cleanupMedia() {
  audioElement.srcObject = null;
  audioElement.pause();
}

let userAgent: UserAgent;
let registerer: Registerer;
let inviter: Inviter;

// Add click listener to connect button
connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  disconnectButton.disabled = true;
  callButton.disabled = true;
  hangupButton.disabled = true;
  initUserAgent();
  if (!userAgent?.isConnected()) {
    try {
      await userAgent?.start();
      registerer = new Registerer(userAgent, {});
      await registerer.register({
        requestDelegate: {
          onReject(response) {
            connectButton.disabled = false;
            disconnectButton.disabled = true;
            callButton.disabled = true;
            hangupButton.disabled = false;
            alert("Failed to connect.\n" + response.message.statusCode);
          }
        }
      });
      connectButton.disabled = true;
      disconnectButton.disabled = false;
      callButton.disabled = false;
      hangupButton.disabled = true;
      const host = getSelect("host").value;
      const port = getInput("port")?.value ?? "5066";
      const webSocketServer = `${host}:${port}`;
      serverSpan.innerHTML = webSocketServer;
    } catch (error) {
      connectButton.disabled = false;
      disconnectButton.disabled = true;
      callButton.disabled = true;
      hangupButton.disabled = false;
      console.error(error);
      alert("Failed to connect.\n" + error);
    }
  }
});

// Add click listener to call button
callButton.addEventListener("click", async () => {
  await makeCall();
});

// Add click listener to hangup button
hangupButton.addEventListener("click", () => {
  callButton.disabled = true;
  hangupButton.disabled = true;
  const session = sessions.get(activatedSessionId);
  console.log(session);
  if (userAgent.isConnected() && session) {
    try {
      session.bye();
    } catch (error) {
      console.error(error);
      alert("Failed to hangup call.\n" + error);
    }
  }
});

// Add click listener to disconnect button
disconnectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  disconnectButton.disabled = true;
  callButton.disabled = true;
  hangupButton.disabled = true;
  try {
    await registerer.unregister();
    await userAgent.stop();
    connectButton.disabled = false;
    disconnectButton.disabled = true;
    callButton.disabled = true;
    hangupButton.disabled = true;
  } catch (error) {
    console.error(error);
  }
});

// Add click listeners to keypad buttons
keypad.forEach((button) => {
  button.addEventListener("click", () => {
    const tone = button.textContent;
    const session = sessions.get(activatedSessionId);
    if (tone && session) {
      session.sessionDescriptionHandler?.sendDtmf(tone);
      dtmfSpan.innerHTML += tone;
    }
  });
});

// Keypad helper function
const keypadDisabled = (disabled: boolean): void => {
  keypad.forEach((button) => (button.disabled = disabled));
  dtmfSpan.innerHTML = "";
};

const holdCall = async () => {
  try {
    const session = sessions.get(activatedSessionId);
    if (session) {
      await session?.invite({
        sessionDescriptionHandlerModifiers: [holdModifier]
      });
      getDiv("hold-list").insertAdjacentHTML(
        "beforeend",
        `<div>${session.remoteIdentity.uri}<span><button data-session-id="${session.id}" name="unhold">Unhold</button><button data-session-id="${session.id}" name="hangup">Hangup</button></span></div>`
      );
    }
  } catch (error) {
    alert(`Failed to hold call.\n` + error);
  }
};
// Add change listener to hold checkbox
holdButton.addEventListener("click", async () => {
  await holdCall();
  onCallEnd();
});

getDiv("hold-list").addEventListener("click", async (e) => {
  if (!(e.target instanceof HTMLButtonElement)) {
    return;
  }
  const btn = e.target;
  if (btn && btn.name === "unhold" && btn.dataset["sessionId"]) {
    if (btn.dataset["sessionId"] !== activatedSessionId) {
      await holdCall();
    }
    const session = sessions.get(btn.dataset["sessionId"]);
    await session?.invite({
      sessionDescriptionHandlerModifiers: []
    });
    onCallStart(btn.dataset["sessionId"]);
    btn.closest("div")?.remove();
  }
});

// Hold helper function
const holdDisabled = (disabled: boolean): void => {
  holdButton.disabled = disabled;
};

// Add change listener to mute checkbox
muteCheckbox.addEventListener("change", () => {
  const session = sessions.get(activatedSessionId);
  if (session) {
    const sdh = session.sessionDescriptionHandler as SessionDescriptionHandler;
    if (muteCheckbox.checked) {
      // Checkbox is checked..
      sdh?.peerConnection?.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === "audio") {
          // track.enabled = false stops the track from capturing sound (mutes local mic)
          sender.track.enabled = false;
        }
      });
    } else {
      // Checkbox is not checked..
      sdh?.peerConnection?.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === "audio") {
          // track.enabled = false stops the track from capturing sound (mutes local mic)
          sender.track.enabled = true;
        }
      });
    }
  }
});

// Mute helper function
const muteCheckboxDisabled = (disabled: boolean): void => {
  muteCheckbox.checked = false;
  muteCheckbox.disabled = disabled;
};

// Enable the connect button
connectButton.disabled = false;
