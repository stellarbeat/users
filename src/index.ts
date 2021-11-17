import * as express from 'express';
import * as bodyParser from 'body-parser';
import { body, param, validationResult } from 'express-validator';
import { User } from './User';
import { config } from 'dotenv';
import { Encryption } from './Encryption';
import { Hasher } from './Hasher';
import { createConnection, getConnection, getRepository } from 'typeorm';
import { Server } from 'net';
import * as basicAuth from 'express-basic-auth';
import { HttpError, MailgunService } from './MailgunService';

config();
const mailgunBaseUrl = process.env.MAILGUN_BASE_URL;
if (!mailgunBaseUrl) throw new Error('No mailgun base url');
const mailgunSecret = process.env.MAILGUN_SECRET;
if (!mailgunSecret) throw new Error('No mailgun secret');
const mailgunFrom = process.env.MAILGUN_FROM;
if (!mailgunFrom) throw new Error('No mailgun from');
const mailgunService = new MailgunService(
	mailgunSecret,
	mailgunFrom,
	mailgunBaseUrl
);
const consumerName = process.env.CONSUMER_NAME;
if (!consumerName) throw new Error('No consumer name');
const consumerSecret = process.env.CONSUMER_SECRET;
if (!consumerSecret) throw new Error('No consumer secret');
const users = {} as { [username: string]: string };
users[consumerName] = consumerSecret;
const secretString = process.env.ENCRYPTION_SECRET;
if (!secretString) throw new Error('No encryption secret');
const secret = Buffer.from(secretString, 'base64');
const hashSecretString = process.env.HASH_SECRET;
if (!hashSecretString) throw new Error('No hash secret');
const hashSecret = Buffer.from(hashSecretString, 'base64');
const encryption = new Encryption(secret);
const hasher = new Hasher(hashSecret);
let port = process.env.PORT;
if (!port) port = '3000';

const api = express();
let server: Server;
api.use(bodyParser.json());
api.use(
	basicAuth({
		users: users
	})
);
api.post(
	'/user',
	[body('emailAddress').isEmail().normalizeEmail()],
	async function (req: express.Request, res: express.Response) {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		try {
			const hash = hasher.hash(Buffer.from(req.body.emailAddress));
			let user = await getRepository(User).findOne({
				where: {
					hash: hash.toString('base64')
				}
			});
			if (user)
				return res.status(200).json({
					userId: user.id
				});

			const { cipher, nonce } = encryption.encrypt(
				Buffer.from(req.body.emailAddress)
			);

			//todo mailgun email address validation
			user = new User(
				cipher.toString('base64'),
				nonce.toString('base64'),
				hash.toString('base64')
			);

			await user.save();
			return res.status(200).json({
				userId: user.id
			});
		} catch (e) {
			return res.status(500).json({ msg: 'Something went wrong' });
		}
	}
);
api.delete(
	'/user/:userId',
	[param('userId').isUUID(4)],
	async function (req: express.Request, res: express.Response) {
		console.log(req.body);
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		try {
			const user = await getRepository(User).findOne(req.params.userId);
			if (!user) return res.status(404).json({ msg: 'User not found' });
			await user.remove();
			return res.status(200).json({ msg: 'User removed' });
		} catch (e) {
			return res.status(500).json({ msg: 'Something went wrong' });
		}
	}
);

api.post(
	'/user/:userId/message',
	[param('userId').isUUID(4), body('message').isString().notEmpty()],
	async function (req: express.Request, res: express.Response) {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		try {
			const user = await getRepository(User).findOne(req.params.userId);
			if (!user) return res.status(404).json({ msg: 'User not found' });

			const emailAddressOrError = encryption.decrypt(
				Buffer.from(user.emailCipher, 'base64'),
				Buffer.from(user.nonce, 'base64')
			);
			if (emailAddressOrError instanceof Error) return res.status(500);

			const result = await mailgunService.sendMessage(
				emailAddressOrError.toString(),
				req.body.message,
				'Notification!'
			);

			if (result instanceof HttpError) {
				console.log(result);
				return res.status(500);
			}
			//todo logging
			if (result.status === 200)
				return res.status(200).json({ msg: 'Message sent' });
			else return res.status(200);
		} catch (e) {
			return res.status(500).json({ msg: 'Something went wrong' });
		}
	}
);

async function listen() {
	await createConnection();
	server = api.listen(port, () =>
		console.log('api listening on port: ' + port)
	);
}

listen();

process.on('SIGTERM', async () => {
	console.log('SIGTERM signal received: closing HTTP server');
	await stop();
});
process.on('SIGINT', async () => {
	console.log('SIGTERM signal received: closing HTTP server');
	await stop();
});

async function stop() {
	await getConnection().close();
	await server.close(() => {
		console.log('HTTP server closed');
	});
}
