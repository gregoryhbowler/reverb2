/**
 * Greyhole Reverb AudioWorklet Processor
 * A complex granular reverb based on the SuperCollider Greyhole UGen
 * 
 * Parameters:
 * - delayTime: Base delay time (0.0 - 10.0 seconds)
 * - size: Size multiplier for delay times (0.5 - 5.0)
 * - damping: High frequency damping (0.0 - 1.0)
 * - diffusion: Allpass diffusion amount (0.0 - 1.0)
 * - feedback: Feedback amount (0.0 - 1.0)
 * - modDepth: Delay line modulation depth (0.0 - 1.0)
 * - modFreq: Delay line modulation frequency (0.0 - 10.0 Hz)
 */

class GreyholeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'delayTime',
        defaultValue: 2.0,
        minValue: 0.0,
        maxValue: 10.0,
        automationRate: 'k-rate'
      },
      {
        name: 'size',
        defaultValue: 3.0,
        minValue: 0.5,
        maxValue: 5.0,
        automationRate: 'k-rate'
      },
      {
        name: 'damping',
        defaultValue: 0.1,
        minValue: 0.0,
        maxValue: 1.0,
        automationRate: 'k-rate'
      },
      {
        name: 'diffusion',
        defaultValue: 0.707,
        minValue: 0.0,
        maxValue: 1.0,
        automationRate: 'k-rate'
      },
      {
        name: 'feedback',
        defaultValue: 0.2,
        minValue: 0.0,
        maxValue: 1.0,
        automationRate: 'k-rate'
      },
      {
        name: 'modDepth',
        defaultValue: 0.0,
        minValue: 0.0,
        maxValue: 1.0,
        automationRate: 'k-rate'
      },
      {
        name: 'modFreq',
        defaultValue: 0.1,
        minValue: 0.0,
        maxValue: 10.0,
        automationRate: 'k-rate'
      }
    ];
  }

  constructor(options) {
    super();
    
    this.sampleRate = options.processorOptions?.sampleRate || sampleRate;
    
    // Maximum delay time: 10 seconds
    const maxDelay = 10.0;
    this.maxDelaySize = Math.ceil(maxDelay * this.sampleRate);
    
    // 8 delay lines for a rich, complex reverb
    this.numDelays = 8;
    this.delayLines = [];
    this.delayIndices = [];
    
    for (let i = 0; i < this.numDelays; i++) {
      this.delayLines[i] = new Float32Array(this.maxDelaySize);
      this.delayIndices[i] = 0;
    }
    
    // Allpass filters for diffusion (4 per channel)
    this.numAllpass = 4;
    this.allpassBuffers = [];
    this.allpassIndices = [];
    
    // Prime number delays for allpass to avoid periodicity
    const allpassDelays = [142, 107, 379, 277];
    
    for (let i = 0; i < this.numAllpass; i++) {
      const size = allpassDelays[i];
      this.allpassBuffers[i] = new Float32Array(size);
      this.allpassIndices[i] = 0;
    }
    
    // Damping filters (one-pole lowpass) state
    this.dampState = new Float32Array(this.numDelays).fill(0);
    
    // Modulation oscillator phase
    this.modPhase = 0;
    
    // Pre-delay buffer for stereo width
    this.preDelaySize = Math.ceil(0.02 * this.sampleRate); // 20ms
    this.preDelayBufferL = new Float32Array(this.preDelaySize);
    this.preDelayBufferR = new Float32Array(this.preDelaySize);
    this.preDelayIndex = 0;
    
    // Delay time ratios for each line (based on Greyhole/JPverb)
    this.delayRatios = [
      1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
    ];
  }

  /**
   * One-pole lowpass filter for damping
   */
  dampFilter(input, state, coeff) {
    state += coeff * (input - state);
    return state;
  }

  /**
   * Allpass filter for diffusion
   */
  allpass(input, bufferIndex, gain) {
    const buffer = this.allpassBuffers[bufferIndex];
    const index = this.allpassIndices[bufferIndex];
    const size = buffer.length;
    
    const delayed = buffer[index];
    const output = -input + delayed;
    buffer[index] = input + (delayed * gain);
    
    this.allpassIndices[bufferIndex] = (index + 1) % size;
    
    return output;
  }

  /**
   * Write to delay line
   */
  writeDelay(lineIndex, value) {
    const index = this.delayIndices[lineIndex];
    this.delayLines[lineIndex][index] = value;
  }

  /**
   * Read from delay line with linear interpolation
   */
  readDelay(lineIndex, delaySamples) {
    const buffer = this.delayLines[lineIndex];
    const writeIndex = this.delayIndices[lineIndex];
    const size = buffer.length;
    
    // Calculate read position
    let readPos = writeIndex - delaySamples;
    while (readPos < 0) readPos += size;
    
    // Linear interpolation
    const index1 = Math.floor(readPos) % size;
    const index2 = (index1 + 1) % size;
    const frac = readPos - Math.floor(readPos);
    
    return buffer[index1] * (1 - frac) + buffer[index2] * frac;
  }

  /**
   * Advance delay line write position
   */
  advanceDelay(lineIndex) {
    this.delayIndices[lineIndex] = 
      (this.delayIndices[lineIndex] + 1) % this.delayLines[lineIndex].length;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    
    if (!input || !input.length || !output || !output.length) {
      return true;
    }
    
    const inputL = input[0] || new Float32Array(128);
    const inputR = input[1] || input[0] || new Float32Array(128);
    const outputL = output[0];
    const outputR = output[1] || output[0];
    
    // Get parameters
    const delayTime = parameters.delayTime;
    const size = parameters.size;
    const damping = parameters.damping;
    const diffusion = parameters.diffusion;
    const feedback = parameters.feedback;
    const modDepth = parameters.modDepth;
    const modFreq = parameters.modFreq;
    
    const blockSize = outputL.length;
    
    for (let i = 0; i < blockSize; i++) {
      // Get parameter values (can be arrays for automation)
      const dt = delayTime.length > 1 ? delayTime[i] : delayTime[0];
      const sz = size.length > 1 ? size[i] : size[0];
      const damp = damping.length > 1 ? damping[i] : damping[0];
      const diff = diffusion.length > 1 ? diffusion[i] : diffusion[0];
      const fb = feedback.length > 1 ? feedback[i] : feedback[0];
      const mDepth = modDepth.length > 1 ? modDepth[i] : modDepth[0];
      const mFreq = modFreq.length > 1 ? modFreq[i] : modFreq[0];
      
      // Update modulation oscillator
      const modValue = Math.sin(this.modPhase * 2 * Math.PI);
      this.modPhase += mFreq / this.sampleRate;
      if (this.modPhase >= 1.0) this.modPhase -= 1.0;
      
      // Input with pre-delay for stereo width
      const inL = inputL[i];
      const inR = inputR[i];
      
      this.preDelayBufferL[this.preDelayIndex] = inL;
      this.preDelayBufferR[this.preDelayIndex] = inR;
      
      const preDelayedL = this.preDelayBufferL[this.preDelayIndex];
      const preDelayedR = this.preDelayBufferR[this.preDelayIndex];
      
      this.preDelayIndex = (this.preDelayIndex + 1) % this.preDelaySize;
      
      // Diffuse the input through allpass filters
      let diffusedL = preDelayedL;
      let diffusedR = preDelayedR;
      
      for (let j = 0; j < this.numAllpass; j++) {
        diffusedL = this.allpass(diffusedL, j, diff * 0.7);
        diffusedR = this.allpass(diffusedR, j, diff * 0.7);
      }
      
      // Process delay lines in a feedback network
      let sumL = 0;
      let sumR = 0;
      
      for (let j = 0; j < this.numDelays; j++) {
        // Calculate delay time with modulation and size
        const baseDelay = dt * this.delayRatios[j] * sz;
        const modAmount = mDepth * 0.1 * this.sampleRate; // Up to 100ms modulation
        const actualDelay = baseDelay * this.sampleRate + (modValue * modAmount);
        
        // Clamp delay time
        const clampedDelay = Math.max(1, Math.min(actualDelay, this.maxDelaySize - 1));
        
        // Read from delay line
        let delayed = this.readDelay(j, clampedDelay);
        
        // Apply damping (lowpass filter in feedback path)
        const dampCoeff = 1.0 - (damp * 0.95); // Scale to prevent complete cutoff
        this.dampState[j] = this.dampFilter(delayed, this.dampState[j], dampCoeff);
        delayed = this.dampState[j];
        
        // Mix input into delay line
        const input = (j % 2 === 0 ? diffusedL : diffusedR) * 0.5;
        const feedbackSample = delayed * fb;
        
        // Write to delay line
        this.writeDelay(j, input + feedbackSample);
        this.advanceDelay(j);
        
        // Accumulate output (alternate channels for stereo)
        if (j % 2 === 0) {
          sumL += delayed;
        } else {
          sumR += delayed;
        }
      }
      
      // Mix dry and wet
      const wetL = sumL / (this.numDelays / 2);
      const wetR = sumR / (this.numDelays / 2);
      
      // Output (preserving dry signal)
      outputL[i] = inL + wetL * 0.5;
      outputR[i] = inR + wetR * 0.5;
    }
    
    return true;
  }
}

registerProcessor('greyhole-processor', GreyholeProcessor);
