import { Injectable } from '@nestjs/common';

/**
 * Node intentionally never claims durable AI jobs. Go is the only queue
 * consumer; this retained service keeps the Node relay runtime composition
 * stable while deploys transition independently.
 */
@Injectable()
export class JobPoller {
  async tick(): Promise<boolean> {
    return false;
  }
}
