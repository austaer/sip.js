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
import { holdModifier, SessionDescriptionHandler, SimpleUser } from "../lib/platform/web/index.js";
import { getAudio, getButton, getButtons, getInput, getSelect, getSpan } from "./demo-utils.js";

const serverSpan = getSpan("server");
const targetSpan = getSpan("target");
const connectButton = getButton("connect");
const callButton = getButton("call");
const hangupButton = getButton("hangup");
const disconnectButton = getButton("disconnect");
const audioElement = getAudio("remoteAudio");
const keypad = getButtons("keypad");
const dtmfSpan = getSpan("dtmf");
const holdCheckbox = getInput("hold");
const muteCheckbox = getInput("mute");
let domainName = getSelect("domainName").value.trim();

// WebSocket Server URL

// Destination URI
const targetEl: HTMLInputElement | null = document.querySelector("#target-input");

// Name for demo user
let holdSession: Session | null;

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

const acceptEvent = async (invitation: Invitation) => {
  await invitation.accept();
  getSpan("call-status").innerHTML = "Answered";
};
const rejectEvent = async (invitation: Invitation) => {
  await invitation.reject();
  getSpan("call-status").innerHTML = "Idle";
};
const blindTransferEvent = async () => {
  const domainName = getSelect("domainName").value.trim();
  const target = UserAgent.makeURI(`sip:${targetEl?.value}@${domainName}`);
  if (target) {
    await session.refer(target);
  }
};

const attendedTransferEvent = async () => {
  if (holdCheckbox.checked && holdSession) {
    await holdSession.refer(session);
  }
};

const consult = async () => {
  const target = targetEl?.value ?? "N/a";
  const domainName = getSelect("domainName").value.trim();
  targetSpan.innerHTML = target;
  if (userAgent.isConnected()) {
    const uri = UserAgent.makeURI(`sip:${target}@${domainName}`);
    if (uri) {
      session = new Inviter(userAgent, uri, { earlyMedia: true });
      session.stateChange.addListener((state: SessionState) => {
        if (state === SessionState.Established) {
          console.log("Speaking with Colleague B. Caller A is still on hold.");
        }
      });
      await session.invite();
    }
  }
};

const call = async () => {
  const target = targetEl?.value ?? "N/a";
  targetSpan.innerHTML = target;
  if (userAgent.isConnected()) {
    try {
      const uri = UserAgent.makeURI(`sip:${target}@${domainName}`);
      if (uri) {
        inviter = new Inviter(userAgent, uri, { earlyMedia: true });
        await inviter.invite({
          sessionDescriptionHandlerModifiers: [forcePCMU],
          withoutSdp: false,
          requestDelegate: {
            onAccept(response) {
              inviter && (session = inviter);
              console.log(response);
              callButton.disabled = true;
              hangupButton.disabled = false;
              keypadDisabled(false);
              holdCheckboxDisabled(false);
              muteCheckboxDisabled(false);
              if (!hasCall) {
                setupRemoteMedia(inviter);
                hasCall = true;
              }
            },
            onProgress(response) {
              inviter && (session = inviter);
              console.log(response);
              callButton.disabled = true;
              hangupButton.disabled = false;
              keypadDisabled(false);
              holdCheckboxDisabled(false);
              muteCheckboxDisabled(false);
              if (!hasCall) {
                setupRemoteMedia(inviter);
                hasCall = true;
              }
            },
            onReject(response) {
              console.log(response);
              callButton.disabled = false;
              hangupButton.disabled = true;
              keypadDisabled(true);
              holdCheckboxDisabled(true);
              muteCheckboxDisabled(true);
              if (hasCall) {
                cleanupMedia();
                hasCall = false;
              }
            }
          }
        });
        const at = (e: Event) => {
          attendedTransferEvent();
        };
        const bt = (e: Event) => {
          blindTransferEvent();
        };
        getButton("consult").addEventListener("click", consult);
        getButton("attended-transfer").addEventListener("click", at);
        getButton("blind-transfer").addEventListener("click", bt);
        inviter.stateChange.addListener((state: SessionState) => {
          switch (state) {
            case SessionState.Initial:
              getSpan("call-status").innerHTML = "Ringing";
              break;
            case SessionState.Establishing:
              break;
            case SessionState.Established:
              callButton.disabled = true;
              hangupButton.disabled = false;
              keypadDisabled(false);
              holdCheckboxDisabled(false);
              muteCheckboxDisabled(false);
              if (!hasCall) {
                setupRemoteMedia(inviter);
                hasCall = true;
              }
              break;
            case SessionState.Terminating:
            // fall through
            case SessionState.Terminated:
              getButton("attended-transfer").removeEventListener("click", at);
              getButton("blind-transfer").removeEventListener("click", bt);
              callButton.disabled = false;
              hangupButton.disabled = true;
              keypadDisabled(true);
              holdCheckboxDisabled(true);
              muteCheckboxDisabled(true);
              cleanupMedia();
              break;
            default:
              throw new Error("Unknown session state.");
          }
        });
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
        console.log(invitation);
        const accept = (e: Event) => {
          acceptEvent(invitation);
        };
        const rejct = (e: Event) => {
          rejectEvent(invitation);
        };
        const at = (e: Event) => {
          attendedTransferEvent();
        };
        const bt = (e: Event) => {
          blindTransferEvent();
        };
        getButton("consult").addEventListener("click", consult);
        getButton("accept").addEventListener("click", accept);
        getButton("reject").addEventListener("click", rejct);
        getButton("attended-transfer").addEventListener("click", at);
        getButton("blind-transfer").addEventListener("click", bt);
        if (invitation.state == SessionState.Initial) {
          getSpan("call-status").innerHTML = "Ringing";
        }
        invitation.stateChange.addListener((state: SessionState) => {
          console.log(state);
          switch (state) {
            case SessionState.Initial:
              break;
            case SessionState.Establishing:
              invitation && (session = invitation);
              break;
            case SessionState.Established:
              callButton.disabled = true;
              hangupButton.disabled = false;
              keypadDisabled(false);
              holdCheckboxDisabled(false);
              muteCheckboxDisabled(false);
              if (!hasCall) {
                setupRemoteMedia(invitation);
                hasCall = true;
              }
              break;
            case SessionState.Terminating:
            // fall through
            case SessionState.Terminated:
              getButton("consult").removeEventListener("click", consult);
              getButton("accept").removeEventListener("click", accept);
              getButton("reject").removeEventListener("click", rejct);
              getButton("attended-transfer").removeEventListener("click", at);
              getButton("blind-transfer").removeEventListener("click", bt);
              callButton.disabled = false;
              hangupButton.disabled = true;
              keypadDisabled(true);
              holdCheckboxDisabled(true);
              muteCheckboxDisabled(true);
              getSpan("call-status").innerHTML = "Idle";
              cleanupMedia();
              break;
            default:
              throw new Error("Unknown session state.");
          }
        });
      }
    }
  };

  userAgent = new UserAgent(transportOptions);
};

const remoteStream = new MediaStream();
function setupRemoteMedia(session: Session) {
  const sdh = session.sessionDescriptionHandler as SessionDescriptionHandler;
  sdh.peerConnection!.getReceivers().forEach((receiver) => {
    if (receiver.track) {
      remoteStream.addTrack(receiver.track);
    }
  });
  audioElement.srcObject = remoteStream;
  audioElement.play();
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

let hasCall = false;
let session: Session;

// Add click listener to call button
callButton.addEventListener("click", async () => {
  await call();
});

// Add click listener to hangup button
hangupButton.addEventListener("click", () => {
  callButton.disabled = true;
  hangupButton.disabled = true;
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
    if (tone) {
      session?.sessionDescriptionHandler?.sendDtmf(tone);
      dtmfSpan.innerHTML += tone;
    }
  });
});

// Keypad helper function
const keypadDisabled = (disabled: boolean): void => {
  keypad.forEach((button) => (button.disabled = disabled));
  dtmfSpan.innerHTML = "";
};

// Add change listener to hold checkbox
holdCheckbox.addEventListener("change", async () => {
  try {
    if (holdCheckbox.checked) {
      await session.invite({
        sessionDescriptionHandlerModifiers: [holdModifier]
      });
      holdSession = session;
    } else {
      await session.invite({
        sessionDescriptionHandlerModifiers: []
      });
      holdSession = null;
    }
  } catch (error) {
    alert(`Failed to ${holdCheckbox.checked ? "hold" : "unhold"} call.\n` + error);
  }
});

// Hold helper function
const holdCheckboxDisabled = (disabled: boolean): void => {
  holdCheckbox.checked = false;
  holdCheckbox.disabled = disabled;
};

// Add change listener to mute checkbox
muteCheckbox.addEventListener("change", () => {
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
});

// Mute helper function
const muteCheckboxDisabled = (disabled: boolean): void => {
  muteCheckbox.checked = false;
  muteCheckbox.disabled = disabled;
};

// Enable the connect button
connectButton.disabled = false;
