/**
 * Greyhole Reverb AudioWorklet Processor
 * Based on diffuser networks with prime-number delays
 * 
 * Parameters:
 * - delayTime: Base delay time multiplier (0.0 - 10.0)
 * - size: Size multiplier for delay times (0.5 - 5.0)
 * - damping: High frequency damping (0.0 - 1.0)
 * - diffusion: Allpass diffusion amount (0.0 - 1.0)
 * - feedback: Feedback amount (0.0 - 1.0)
 * - modDepth: Delay line modulation depth (0.0 - 1.0)
 * - modFreq: Delay line modulation frequency (0.0 - 10.0 Hz)
 * - mix: Wet/dry mix (0.0 - 1.0)
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
        defaultValue: 0.7,
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
      },
      {
        name: 'mix',
        defaultValue: 1.0,
        minValue: 0.0,
        maxValue: 1.0,
        automationRate: 'k-rate'
      }
    ];
  }

  constructor(options) {
    super();
    
    this.sampleRate = sampleRate;
    
    // Prime numbers as millisecond base times
    // These will be scaled to create delays in the 20-500ms range
    this.primes = [37, 43, 47, 53, 59, 61, 67, 71];
    
    // Create delay lines based on prime numbers
    this.numDelays = 8;
    this.delayLines = [];
    this.delayIndices = [];
    
    // Maximum delay: 4 seconds to be safe
    const maxDelaySeconds = 4.0;
    const maxDelay = Math.ceil(maxDelaySeconds * this.sampleRate);
    
    for (let i = 0; i < this.numDelays; i++) {
      this.delayLines[i] = new Float32Array(maxDelay);
      this.delayIndices[i] = 0;
    }
    
    // Damping filter state (one-pole lowpass)
    this.dampState = new Float32Array(this.numDelays).fill(0);
    
    // Modulation oscillators (one per delay line for variation)
    this.modPhases = new Float32Array(this.numDelays).fill(0);
    
    // Initialize mod phases at different starting points
    for (let i = 0; i < this.numDelays; i++) {
      this.modPhases[i] = i / this.numDelays;
    }
    
    console.log('Greyhole initialized with prime delays (ms):', this.primes);
  }

  /**
   * Rotation matrix for stereo diffusion
   */
  rotate(left, right, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
      left * c - right * s,
      left * s + right * c
    ];
  }

  /**
   * Write to delay line
   */
  writeDelay(lineIndex, value) {
    const index = this.delayIndices[lineIndex];
    this.delayLines[lineIndex][index] = value;
    this.delayIndices[lineIndex] = (index + 1) % this.delayLines[lineIndex].length;
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

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    
    if (!input || !input[0] || !output || !output[0]) {
      return true;
    }
    
    const inputL = input[0];
    const inputR = input[1] || input[0];
    const outputL = output[0];
    const outputR = output[1] || output[0];
    
    // Get parameters
    const delayTime = parameters.delayTime[0];
    const size = parameters.size[0];
    const damping = parameters.damping[0];
    const diffusion = parameters.diffusion[0];
    const feedback = parameters.feedback[0];
    const modDepth = parameters.modDepth[0];
    const modFreq = parameters.modFreq[0];
    const mix = parameters.mix[0];
    
    // Diffusion gain (cos/sin relationship like Faust)
    const diffGain = Math.cos(diffusion * Math.PI * 0.5);
    const diffMix = Math.sin(diffusion * Math.PI * 0.5);
    
    const blockSize = outputL.length;
    
    for (let i = 0; i < blockSize; i++) {
      const inL = inputL[i];
      const inR = inputR[i];
      
      // First diffusion stage - rotate input
      let [diffL, diffR] = this.rotate(inL, inR, diffusion * 0.3);
      
      // Process through delay network
      let wetL = 0;
      let wetR = 0;
      
      // Process delays in pairs for stereo
      for (let d = 0; d < this.numDelays; d += 2) {
        // Update modulation for this delay pair
        const mod1 = Math.sin(this.modPhases[d] * 2 * Math.PI);
        const mod2 = Math.sin(this.modPhases[d + 1] * 2 * Math.PI);
        this.modPhases[d] += modFreq / this.sampleRate;
        this.modPhases[d + 1] += (modFreq * 1.1) / this.sampleRate; // Slightly different rate
        if (this.modPhases[d] >= 1.0) this.modPhases[d] -= 1.0;
        if (this.modPhases[d + 1] >= 1.0) this.modPhases[d + 1] -= 1.0;
        
        // Calculate delay times based on primes (treating them as milliseconds)
        // Base: prime value in ms, scaled by delayTime and size parameters
        const baseDelayMs1 = this.primes[d] * (0.5 + delayTime * 0.5) * size;
        const baseDelayMs2 = this.primes[d + 1] * (0.5 + delayTime * 0.5) * size;
        
        // Convert milliseconds to samples
        const baseDelay1 = (baseDelayMs1 / 1000) * this.sampleRate;
        const baseDelay2 = (baseDelayMs2 / 1000) * this.sampleRate;
        
        // Add modulation
        const modAmt = modDepth * 10 * (this.sampleRate / 1000); // Up to 10ms modulation
        const delay1 = Math.max(1, baseDelay1 + mod1 * modAmt);
        const delay2 = Math.max(1, baseDelay2 + mod2 * modAmt);
        
        // Read from delay lines
        let delayed1 = this.readDelay(d, delay1);
        let delayed2 = this.readDelay(d + 1, delay2);
        
        // Apply damping (one-pole lowpass)
        const dampCoeff = 0.99 - (damping * 0.94); // 0.99 to 0.05
        this.dampState[d] += dampCoeff * (delayed1 - this.dampState[d]);
        this.dampState[d + 1] += dampCoeff * (delayed2 - this.dampState[d + 1]);
        delayed1 = this.dampState[d];
        delayed2 = this.dampState[d + 1];
        
        // Diffuser feedback matrix (like Faust implementation)
        const fb1 = delayed1 * feedback;
        const fb2 = delayed2 * feedback;
        
        // Mix with input (diffusion network structure)
        const in1 = (d % 4 === 0) ? diffL : diffR;
        const in2 = (d % 4 === 0) ? diffR : diffL;
        
        // Allpass-like structure: out = -in + delayed, write = in + delayed * g
        const toWrite1 = in1 * diffMix + fb1 * diffGain;
        const toWrite2 = in2 * diffMix + fb2 * diffGain;
        
        this.writeDelay(d, toWrite1);
        this.writeDelay(d + 1, toWrite2);
        
        // Rotate the delayed signals for diffusion
        const [rot1, rot2] = this.rotate(delayed1, delayed2, (d / this.numDelays) * Math.PI);
        
        // Accumulate to output (alternate L/R)
        wetL += rot1;
        wetR += rot2;
      }
      
      // Average and scale the wet signal
      wetL = wetL / (this.numDelays / 2);
      wetR = wetR / (this.numDelays / 2);
      
      // Final rotation for stereo width
      [wetL, wetR] = this.rotate(wetL, wetR, 0.2);
      
      // Mix dry and wet
      outputL[i] = inL * (1 - mix) + wetL * mix * 0.8;
      outputR[i] = inR * (1 - mix) + wetR * mix * 0.8;
    }
    
    return true;
  }
}

registerProcessor('greyhole-processor', GreyholeProcessor);
