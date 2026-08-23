create table version_master
(
	version varchar(255) not null,
	updated_timestamp bigint null,
	final_edit_timestamp bigint null,
	beta tinyint(1) default 1 not null,
	verified tinyint(1) default 0 not null,
	alerted tinyint(1) default 0 null,
	mac tinyint(1) default 0 null,
	win tinyint(1) default 0 null,
	download_count bigint default 0 null
);

