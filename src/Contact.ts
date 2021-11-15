import {
	BaseEntity,
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn
} from 'typeorm';

@Entity()
export class Contact extends BaseEntity {
	@Column({ type: 'varchar' })
	public emailCipher: string;

	@Column({ type: 'varchar' })
	public nonce: string;

	@Index()
	@Column({ type: 'varchar' })
	public hash: string;

	@PrimaryGeneratedColumn('uuid')
	public id?: string;

	@CreateDateColumn()
	public createDate?: Date;

	constructor(emailCipher: string, nonce: string, hash: string) {
		super();
		this.emailCipher = emailCipher;
		this.nonce = nonce;
		this.hash = hash;
	}
}
