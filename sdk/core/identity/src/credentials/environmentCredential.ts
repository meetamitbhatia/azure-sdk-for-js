// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { TokenCredential, isNode, RequestOptionsBase, TokenResult } from '@azure/core-http';
import { IdentityClientOptions } from '../client/identityClient';
import { ClientSecretCredential } from './clientSecretCredential';

export class EnvironmentCredential implements TokenCredential {
  private _credential?: TokenCredential = undefined;

  constructor(options?: IdentityClientOptions) {
    if (!isNode) {
      throw 'EnvironmentCredential is only supported when running in Node.js.'
    }

    const
      tenantId = process.env.AZURE_TENANT_ID,
      clientId = process.env.AZURE_CLIENT_ID,
      clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (tenantId && clientId && clientSecret) {
      this._credential = new ClientSecretCredential(tenantId, clientId, clientSecret)
    }
  }

  async getToken(scopes: string[], requestOptions?: RequestOptionsBase): Promise<TokenResult> {
    if (this._credential) {
      return await this._credential.getToken(scopes, requestOptions)
    }

    return { result: 'unavailable', reason: 'No client secret credentials were found in the AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET environment variables.' }
  }
}