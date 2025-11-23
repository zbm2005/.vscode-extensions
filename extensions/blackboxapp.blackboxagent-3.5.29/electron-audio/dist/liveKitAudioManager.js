"use strict";
//audioChatManager.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiveKitAudioChatManager = void 0;
const livekit_client_1 = require("livekit-client");
function log(...args) {
    console.log('[LiveKitAudioChatManager]', ...args);
}
class LiveKitAudioChatManager {
    constructor(sendDataToMain) {
        this.audioRoom = null;
        this.audioLocalStream = null;
        this.lastServerUrl = '';
        this.lastToken = '';
        this.sendDataToMain = sendDataToMain;
    }
    async connectAudioRoom(wsServerUrl, participantToken) {
        console.log('Starting to connect room');
        this.sendDataToMain({ "message": 'Test message to main: Starting to connect room' });
        // Store connection parameters for potential reconnection
        this.lastServerUrl = wsServerUrl;
        this.lastToken = participantToken;
        this.audioRoom = new livekit_client_1.Room();
        // Monitor connection state events
        this.audioRoom.on(livekit_client_1.RoomEvent.Connected, () => {
            log('Room connected successfully');
            this.sendDataToMain({ type: 'room-event-connected' });
        });
        this.audioRoom.on(livekit_client_1.RoomEvent.Disconnected, (reason) => {
            log('Room disconnected, reason:', reason);
            this.sendDataToMain({ type: 'room-event-disconnected', reason });
        });
        this.audioRoom.on(livekit_client_1.RoomEvent.Reconnecting, () => {
            log('Room reconnecting...');
            this.sendDataToMain({ type: 'room-event-reconnecting' });
        });
        this.audioRoom.on(livekit_client_1.RoomEvent.Reconnected, () => {
            log('Room reconnected successfully');
            this.sendDataToMain({ type: 'room-event-reconnected' });
        });
        this.audioRoom.on(livekit_client_1.RoomEvent.ConnectionStateChanged, (state) => {
            log('Room connection state changed:', state);
            this.sendDataToMain({ type: 'room-event-connection-state', state });
        });
        // Connect to room
        await this.audioRoom.connect(wsServerUrl, participantToken, { autoSubscribe: true });
        this.sendDataToMain({ "room-details": this.audioRoom.name, "localparticipantKind": this.audioRoom.localParticipant.kind });
        this.audioRoom.on("trackSubscribed", (track, publication) => {
            this.sendDataToMain({ type: 'room-event-track-subscribed', "publication": publication.trackName, "isLocal": publication.isLocal, "source": publication.source });
        });
        this.audioRoom.on("trackPublished", (publication, participant) => {
            this.sendDataToMain({ type: 'room-event-track-subscribed', "publication": publication.trackName, "isLocal": publication.isLocal, "source": publication.source });
        });
        console.log('Finished to connect room', this.audioRoom);
        return this.audioRoom;
    }
    // private async initializeAudio() {
    //   if (!navigator?.mediaDevices?.getUserMedia) {
    //     throw new Error('Audio capture not supported in this environment.')
    //   }
    //   this.audioLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    //   log('Local audio stream initialized.')
    // }
    async getAudioDevices() {
        log('Fetching audio devices...');
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = devices.filter(d => d.kind === "audioinput");
        // Get active deviceId from audioTrackPublications
        let activeDeviceId = undefined;
        const publications = this.audioRoom?.localParticipant?.audioTrackPublications;
        if (publications) {
            for (const publication of publications.values()) {
                if (publication.track && publication.track.mediaStreamTrack) {
                    const deviceId = publication.track.mediaStreamTrack.getSettings()?.deviceId;
                    if (deviceId) {
                        activeDeviceId = deviceId;
                        break;
                    }
                }
            }
        }
        return {
            devices: audioDevices.map(device => ({
                deviceId: device.deviceId,
                label: device.label,
                isActive: device.deviceId === activeDeviceId
            })),
            activeDeviceId: activeDeviceId
        };
    }
    async startRecording() {
        try {
            log('Starting audio recording...');
            this.sendDataToMain({ type: 'recording-status', status: 'starting' });
            if (!this.audioRoom) {
                throw new Error('Audio room not connected');
            }
            // Get available audio devices
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioDevices = devices.filter(d => d.kind === "audioinput");
            if (audioDevices.length === 0) {
                throw new Error('No audio input devices found');
            }
        }
        catch (error) {
            log('Error starting audio recording:', error);
            this.sendDataToMain({
                type: 'recording-status',
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    async sendText(text) {
        try {
            if (!this.audioRoom) {
                throw new Error('Audio room not initialized');
            }
            // Check if room is connected
            if (this.audioRoom.state !== 'connected') {
                log('Room not connected, attempting to reconnect...');
                this.sendDataToMain({ type: 'room-event-reconnecting' });
                if (!this.lastServerUrl || !this.lastToken) {
                    throw new Error('Cannot reconnect: missing connection parameters');
                }
                // Attempt to reconnect
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Reconnection timeout'));
                    }, 5000);
                    const onReconnected = () => {
                        clearTimeout(timeout);
                        this.audioRoom?.off(livekit_client_1.RoomEvent.Connected, onReconnected);
                        resolve(true);
                    };
                    this.audioRoom?.on(livekit_client_1.RoomEvent.Connected, onReconnected);
                    this.audioRoom?.connect(this.lastServerUrl, this.lastToken, { autoSubscribe: true })
                        .catch(err => {
                        clearTimeout(timeout);
                        reject(err);
                    });
                });
            }
            await this.audioRoom.localParticipant.sendText(text, { topic: "lk.chat" });
            this.sendDataToMain({ type: 'text-sent', success: true });
        }
        catch (error) {
            log('Error sending text:', error);
            this.sendDataToMain({
                type: 'text-status',
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    async stopRecording() {
        try {
            log('Stopping audio recording...');
            this.sendDataToMain({ type: 'recording-status', status: 'stopping' });
            if (!this.audioRoom) {
                throw new Error('Audio room not connected');
            }
            await this.audioRoom?.localParticipant.setMicrophoneEnabled(false);
            // Clean up any local audio stream if it exists
            if (this.audioLocalStream) {
                this.audioLocalStream.getTracks().forEach(track => track.stop());
                this.audioLocalStream = null;
            }
            log('Audio recording stopped successfully');
            this.sendDataToMain({ type: 'recording-status', status: 'stopped' });
        }
        catch (error) {
            log('Error stopping audio recording:', error);
            this.sendDataToMain({
                type: 'recording-status',
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    async toggleMute() {
        try {
            if (!this.audioRoom) {
                throw new Error('Audio room not connected');
            }
            const currentState = this.audioRoom.localParticipant.isMicrophoneEnabled;
            await this.audioRoom.localParticipant.setMicrophoneEnabled(!currentState);
            this.sendDataToMain({
                type: 'mic-status',
                status: !currentState ? 'unmuted' : 'muted'
            });
        }
        catch (error) {
            log('Error toggling mute:', error);
            this.sendDataToMain({
                type: 'mic-status',
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
}
exports.LiveKitAudioChatManager = LiveKitAudioChatManager;
