import { Global, Module } from '@nestjs/common';

import { TokenCipherService } from './token-cipher';

/** Token encryption (ADR-0005), available to the API and the worker. */
@Global()
@Module({ providers: [TokenCipherService], exports: [TokenCipherService] })
export class CryptoModule {}
