import type { ILicenseTag, LicenseModule } from '@rocket.chat/core-typings';
import type { ServerMethods } from '@rocket.chat/ddp-client';
import { License } from '@rocket.chat/license';
import { check } from 'meteor/check';
import { Meteor } from 'meteor/meteor';

import { methodDeprecationLogger } from '../../../../app/lib/server/lib/deprecationWarningLogger';

declare module '@rocket.chat/ddp-client' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		'license:hasLicense'(feature: string): boolean;
		'license:getModules'(): string[];
		'license:getTags'(): ILicenseTag[];
		'license:isEnterprise'(): boolean;
	}
}

Meteor.methods<ServerMethods>({
	/**
	 * @deprecated Scheduled for removal in 9.0.0. No caller found in this repository — kept for external DDP clients only.
	 */
	'license:hasLicense'(feature: string) {
		methodDeprecationLogger.method('license:hasLicense', '9.0.0', []);
		check(feature, String);

		return License.hasModule(feature as LicenseModule);
	},
	'license:getModules'() {
		return License.getModules();
	},
	/**
	 * @deprecated Scheduled for removal in 9.0.0. No caller found in this repository — kept for external DDP clients only.
	 */
	'license:getTags'() {
		methodDeprecationLogger.method('license:getTags', '9.0.0', []);
		return License.getTags();
	},
	'license:isEnterprise'() {
		return License.hasValidLicense();
	},
});
