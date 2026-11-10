import { truewatchSdk } from '@truewatchtech/cocos-sdk/creator2';

// Use the installer with --replay --web and the adjacent project configuration.
export function startTelemetry(): void { truewatchSdk.start(); }
export function levelStarted(level: number): void { truewatchSdk.rum.addAction('level_started', 'game', { level }); }
export function startRecording(): void { truewatchSdk.replay.start(); }
export function stopRecording(): void { truewatchSdk.replay.stop(); }
export function stopTelemetry(): void { truewatchSdk.stop(); }
