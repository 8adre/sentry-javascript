import { Hub } from '@sentry/hub';
import { EventProcessor, Integration } from '@sentry/types';
import { fill, logger } from '@sentry/utils';

interface PgClient {
  prototype: {
    query: () => void | Promise<unknown>;
  };
}

interface PostgresOptions {
  client?: PgClient;
}

/** Tracing integration for node-postgres package */
export class Postgres implements Integration {
  /**
   * @inheritDoc
   */
  public static id: string = 'Postgres';

  /**
   * @inheritDoc
   */
  public name: string = Postgres.id;

  private _client?: PgClient;

  /**
   * @inheritDoc
   */
  public constructor(options: PostgresOptions = {}) {
    this._client = options.client;
  }

  /**
   * @inheritDoc
   */
  public setupOnce(_: (callback: EventProcessor) => void, getCurrentHub: () => Hub): void {
    if (!this._client) {
      logger.error('PostgresIntegration is missing a Postgres.Client constructor');
      return;
    }

    /**
     * function (query, callback) => void
     * function (query, params, callback) => void
     * function (query) => Promise
     * function (query, params) => Promise
     */
    fill(this._client.prototype, 'query', function(orig: () => void | Promise<unknown>) {
      return function(this: unknown, config: unknown, values: unknown, callback: unknown) {
        const scope = getCurrentHub().getScope();
        const transaction = scope?.getTransaction();
        const span = transaction?.startChild({
          description: typeof config === 'string' ? config : (config as { text: string }).text,
          op: `query`,
        });

        if (typeof callback === 'function') {
          return orig.call(this, config, values, function(err: Error, result: unknown) {
            if (span) span.finish();
            callback(err, result);
          });
        }

        if (typeof values === 'function') {
          return orig.call(this, config, function(err: Error, result: unknown) {
            if (span) span.finish();
            values(err, result);
          });
        }

        return (orig.call(this, config, values) as Promise<unknown>).then((res: unknown) => {
          if (span) span.finish();
          return res;
        });
      };
    });
  }
}
