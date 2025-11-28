/**
 * Greyhole Reverb Node
 * Web Audio AudioWorklet wrapper for the Greyhole reverb processor
 * 
 * Usage:
 * 
 * const context = new AudioContext();
 * await context.audioWorklet.addModule('greyhole-processor.js');
 * const greyhole = new GreyholeNode(context);
 * 
 * // Connect audio
 * source.connect(greyhole.input);
 * greyhole.connect(context.destination);
 * 
 * // Control parameters
 * greyhole.delayTime = 3.0;
 * greyhole.size = 2.5;
 * greyhole.damping = 0.2;
 * greyhole.diffusion = 0.8;
 * greyhole.feedback = 0.3;
 * greyhole.modDepth = 0.1;
 * greyhole.modFreq = 0.5;
 */

class GreyholeNode extends AudioWorkletNode {
  constructor(context, options = {}) {
    const nodeOptions = {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        sampleRate: context.sampleRate
      }
    };

    super(context, 'greyhole-processor', nodeOptions);

    // Create a gain node for input to ensure proper connection handling
    this._inputNode = context.createGain();
    this._inputNode.connect(this);

    // Initialize parameter values
    if (options.delayTime !== undefined) this.delayTime = options.delayTime;
    if (options.size !== undefined) this.size = options.size;
    if (options.damping !== undefined) this.damping = options.damping;
    if (options.diffusion !== undefined) this.diffusion = options.diffusion;
    if (options.feedback !== undefined) this.feedback = options.feedback;
    if (options.modDepth !== undefined) this.modDepth = options.modDepth;
    if (options.modFreq !== undefined) this.modFreq = options.modFreq;
    if (options.mix !== undefined) this.mix = options.mix;
  }

  /**
   * Get the input node for connecting sources
   */
  get input() {
    return this._inputNode;
  }

  /**
   * Delay time in seconds (0.0 - 10.0)
   */
  get delayTime() {
    return this.parameters.get('delayTime').value;
  }

  set delayTime(value) {
    this.parameters.get('delayTime').value = Math.max(0, Math.min(10, value));
  }

  /**
   * Size multiplier for delay times (0.5 - 5.0)
   */
  get size() {
    return this.parameters.get('size').value;
  }

  set size(value) {
    this.parameters.get('size').value = Math.max(0.5, Math.min(5, value));
  }

  /**
   * High frequency damping amount (0.0 - 1.0)
   */
  get damping() {
    return this.parameters.get('damping').value;
  }

  set damping(value) {
    this.parameters.get('damping').value = Math.max(0, Math.min(1, value));
  }

  /**
   * Diffusion amount (0.0 - 1.0)
   */
  get diffusion() {
    return this.parameters.get('diffusion').value;
  }

  set diffusion(value) {
    this.parameters.get('diffusion').value = Math.max(0, Math.min(1, value));
  }

  /**
   * Feedback amount (0.0 - 1.0)
   */
  get feedback() {
    return this.parameters.get('feedback').value;
  }

  set feedback(value) {
    this.parameters.get('feedback').value = Math.max(0, Math.min(1, value));
  }

  /**
   * Delay line modulation depth (0.0 - 1.0)
   */
  get modDepth() {
    return this.parameters.get('modDepth').value;
  }

  set modDepth(value) {
    this.parameters.get('modDepth').value = Math.max(0, Math.min(1, value));
  }

  /**
   * Delay line modulation frequency in Hz (0.0 - 10.0)
   */
  get modFreq() {
    return this.parameters.get('modFreq').value;
  }

  set modFreq(value) {
    this.parameters.get('modFreq').value = Math.max(0, Math.min(10, value));
  }

  /**
   * Wet/dry mix (0.0 = dry, 1.0 = wet)
   */
  get mix() {
    return this.parameters.get('mix').value;
  }

  set mix(value) {
    this.parameters.get('mix').value = Math.max(0, Math.min(1, value));
  }

  /**
   * Set all parameters at once
   */
  setParameters(params) {
    if (params.delayTime !== undefined) this.delayTime = params.delayTime;
    if (params.size !== undefined) this.size = params.size;
    if (params.damping !== undefined) this.damping = params.damping;
    if (params.diffusion !== undefined) this.diffusion = params.diffusion;
    if (params.feedback !== undefined) this.feedback = params.feedback;
    if (params.modDepth !== undefined) this.modDepth = params.modDepth;
    if (params.modFreq !== undefined) this.modFreq = params.modFreq;
    if (params.mix !== undefined) this.mix = params.mix;
  }

  /**
   * Get all current parameter values
   */
  getParameters() {
    return {
      delayTime: this.delayTime,
      size: this.size,
      damping: this.damping,
      diffusion: this.diffusion,
      feedback: this.feedback,
      modDepth: this.modDepth,
      modFreq: this.modFreq,
      mix: this.mix
    };
  }

  /**
   * Schedule parameter changes for automation
   * 
   * @param {string} paramName - Name of the parameter
   * @param {number} value - Target value
   * @param {number} time - Time in seconds (audioContext.currentTime + offset)
   * @param {number} [rampTime=0] - Ramp duration in seconds (0 for instant)
   */
  scheduleParameter(paramName, value, time, rampTime = 0) {
    const param = this.parameters.get(paramName);
    if (!param) {
      console.warn(`Parameter "${paramName}" does not exist`);
      return;
    }

    if (rampTime > 0) {
      param.linearRampToValueAtTime(value, time + rampTime);
    } else {
      param.setValueAtTime(value, time);
    }
  }

  /**
   * Reset all parameters to defaults
   */
  resetToDefaults() {
    this.delayTime = 2.0;
    this.size = 3.0;
    this.damping = 0.1;
    this.diffusion = 0.707;
    this.feedback = 0.7;
    this.modDepth = 0.0;
    this.modFreq = 0.1;
    this.mix = 1.0;
  }

  /**
   * Disconnect and cleanup
   */
  dispose() {
    this._inputNode.disconnect();
    this.disconnect();
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GreyholeNode;
}
