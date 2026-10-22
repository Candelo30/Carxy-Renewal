import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AudioReactiveService {
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private source?: MediaElementAudioSourceNode | MediaStreamAudioSourceNode;
  private stream?: MediaStream;
  private frequencyData?: Uint8Array<ArrayBuffer>;
  private audioElement?: HTMLAudioElement;
  private audioUrl?: string;

  public async startFile(file: File): Promise<void> {
    await this.stop();
    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.frequencyData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.audioUrl = URL.createObjectURL(file);
    this.audioElement = new Audio(this.audioUrl);
    this.audioElement.loop = true;
    const mediaSource = this.context.createMediaElementSource(this.audioElement);
    mediaSource.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    await this.audioElement.play();
  }

  public async startMicrophone(): Promise<void> {
    await this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.frequencyData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.source = this.context.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
    await this.context.resume();
  }

  public readLevels(): { bass: number; treble: number } {
    if (!this.analyser || !this.frequencyData) return { bass: 0, treble: 0 };
    this.analyser.getByteFrequencyData(this.frequencyData);
    const average = (start: number, end: number): number => {
      let total = 0;
      for (let index = start; index < end; index++) total += this.frequencyData![index];
      return total / Math.max(end - start, 1) / 255;
    };
    return {
      bass: average(0, Math.max(1, Math.floor(this.frequencyData.length * 0.12))),
      treble: average(Math.floor(this.frequencyData.length * 0.55), this.frequencyData.length),
    };
  }

  public async stop(): Promise<void> {
    this.audioElement?.pause();
    this.audioElement?.removeAttribute('src');
    this.audioElement = undefined;
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = undefined;
    this.source?.disconnect();
    this.source = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = undefined;
    this.analyser = undefined;
    this.frequencyData = undefined;
  }
}
