import os from 'os';

/**
 * Resource throttling utility to prevent CPU/memory exhaustion during indexing
 * Ensures the MCP server doesn't freeze the user's laptop
 */
export class ResourceThrottle {
  constructor(config) {
    // Max CPU usage as percentage (default 50%)
    this.maxCpuPercent = config.maxCpuPercent || 50;
    
    // Delay between batches in milliseconds
    this.batchDelay = config.batchDelay || 100;
    
    // Max worker threads (override auto-detection)
    const cpuCount = os.cpus().length;
    if (config.maxWorkers === 'auto' || config.maxWorkers === undefined) {
      // Use 25% of cores by default for throttling (more conservative)
      this.maxWorkers = Math.max(1, Math.floor(cpuCount * 0.25));
    } else {
      // Validate and parse the value
      const parsed = typeof config.maxWorkers === 'number' 
        ? config.maxWorkers 
        : parseInt(config.maxWorkers, 10);
      
      if (isNaN(parsed) || parsed < 1) {
        console.error(`[Throttle] Invalid maxWorkers: ${config.maxWorkers}, using auto`);
        this.maxWorkers = Math.max(1, Math.floor(cpuCount * 0.5));
      } else {
        this.maxWorkers = Math.max(1, Math.min(parsed, cpuCount));
      }
    }
    
    console.error(`[Throttle] CPU limit: ${this.maxCpuPercent}%, Batch delay: ${this.batchDelay}ms, Max workers: ${this.maxWorkers}`);
  }

  /**
   * Execute work with delay to throttle CPU usage
   */
  async throttledBatch(work, signal = null) {
    // Execute the work
    if (work) {
      await work();
    }
    
    // Apply delay if not aborted
    if (!signal?.aborted && this.batchDelay > 0) {
      await this.sleep(this.batchDelay);
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate optimal worker count based on CPU limit
   */
  getWorkerCount(requestedWorkers) {
    if (requestedWorkers === 'auto') {
      return this.maxWorkers;
    }
    return Math.min(requestedWorkers, this.maxWorkers);
  }

  /**
   * Check if we should pause due to high CPU usage
   * This is a simple implementation - could be enhanced with actual CPU monitoring
   */
  async checkCpuUsage() {
    // Future enhancement: monitor actual CPU usage and pause if needed
    // For now, we rely on worker limits and batch delays
    return true;
  }
}

/**
 * Sleep utility function
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
