/**
 * The client-connection RPC surface the browser card reads.
 *
 * The card must never hold the API key, so every credentialed read happens
 * here: `usage/read` resolves the route's credential per call, `credential/set`
 * writes a new one through the harness credentials seam, and
 * `credential/status` answers presence and writability without the value. The
 * channel name, endpoint names, and reply envelopes match what the ecosystem's
 * Ollama provider UIs already call (`/ollama-cloud` + `usage/read`), so an
 * installed provider UI reads this plugin's usage without knowing about it.
 *
 * A failure reply never carries the secret, and the reference a write targets
 * is the configured one — a client cannot redirect a write to another seam
 * entry it names.
 *
 * @module dsh-ollama-cloud/rpc
 */
import { type CredentialProvider } from '@deepseek-ai/dsh-credentials';
import type { ConnectionOptions } from './config.js';
import type { ResolveCredential } from './credentials.js';
import { type OllamaUsageSnapshot } from './usage.js';
/** Channel the browser half registers and calls under. */
export declare const USAGE_RPC_CHANNEL = "/ollama-cloud";
/** Read one usage snapshot. */
export declare const USAGE_ENDPOINT = "usage/read";
/** Report whether the route's credential is configured, without its value. */
export declare const CREDENTIAL_STATUS_ENDPOINT = "credential/status";
/** Store a credential under the route's configured reference. */
export declare const CREDENTIAL_SET_ENDPOINT = "credential/set";
/**
 * Failure reply the connection seam serializes as `{ok:false, error}`.
 * `details` is required by the seam's envelope, so an empty object stands in
 * for "no extra facts"; nothing here ever carries a secret.
 */
export interface RpcFailure {
    readonly ok: false;
    readonly error: {
        readonly code: string;
        readonly message: string;
        readonly details: Record<string, unknown>;
    };
}
/** Success reply the connection seam serializes as `{ok:true, value}`. */
export interface RpcSuccess<T> {
    readonly ok: true;
    readonly value: T;
}
/** One RPC reply. */
export type RpcReply<T> = RpcSuccess<T> | RpcFailure;
/** `usage/read` value: a snapshot, or the endpoint has no usage surface. */
export type UsageReadValue = {
    readonly status: 'ok';
    readonly usage: OllamaUsageSnapshot;
} | {
    readonly status: 'unsupported';
};
/** `credential/status` value: presence and writability, never the value. */
export interface CredentialStatusValue {
    /** Reference the route resolves, when it names one. */
    readonly reference: string | undefined;
    /** Whether a usable value resolves right now (store or environment). */
    readonly configured: boolean;
    /** Whether the credentials seam could currently store a value here. */
    readonly writable: boolean;
}
/** `credential/set` value: the state after the write. */
export interface CredentialSetValue {
    /** Whether a usable value resolves after the write. */
    readonly configured: boolean;
    /** Whether another write could currently succeed. */
    readonly writable: boolean;
}
/** Every value this channel answers with. */
export type UsageRpcValue = UsageReadValue | CredentialStatusValue | CredentialSetValue;
/** The handler the connection service calls for one endpoint. */
export type UsageRpcHandler = (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<RpcReply<UsageRpcValue>>;
/** Everything the handler resolves per call, so settings changes land immediately. */
export interface UsageRpcOptions {
    /** Current validated connection facts. */
    readonly connection: () => ConnectionOptions;
    /** The non-throwing credential resolver every read shares. */
    readonly resolveCredential: ResolveCredential;
    /** The credentials service, when this deployment has one. */
    readonly credentials: () => CredentialProvider | undefined;
    /** Fetch implementation, injectable for tests. */
    readonly fetch: typeof fetch;
    /** Attribution headers for outbound requests. */
    readonly attribution: () => Record<string, string>;
}
/**
 * Build the handler for this plugin's RPC channel.
 * @param options - live resolution hooks.
 * @returns the handler to register with `connection.rpc.handle`.
 */
export declare function createUsageRpcHandler(options: UsageRpcOptions): UsageRpcHandler;
//# sourceMappingURL=rpc.d.ts.map