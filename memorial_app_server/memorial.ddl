create table memorial.user_master
(
    uid                      varchar(255) not null
        primary key,
    username                 varchar(255) null,
    google_auth_id           varchar(100) null,
    google_email             varchar(100) null,
    google_profile_image_url varchar(255) null,
    auth_id                  varchar(50)  null,
    auth_encrypted_pw        varchar(255) null,
    auth_profile_image_url   varchar(255) null,
    constraint user_master_google_auth_id_uindex
        unique (google_auth_id),
    constraint user_master_uid_uindex
        unique (uid)
);

create table memorial.admin_master
(
    uid varchar(255) null,
    constraint admin_master_user_master_uid_fk
        foreign key (uid) references memorial.user_master (uid)
);

create table memorial.transactions
(
    txid      int auto_increment
        primary key,
    version   int          not null,
    type      int          not null,
    `from`    varchar(255) not null,
    timestamp bigint       not null,
    content   blob         null,
    hash      varchar(255) not null,
    constraint transactions_hash_uindex
        unique (hash),
    constraint transactions_user_master_uid_fk
        foreign key (`from`) references memorial.user_master (uid)
);

create table memorial.blocks
(
    uid             varchar(255) not null,
    block_hash      varchar(255) not null,
    transitions     longblob     null,
    state           longblob     null,
    block_number    bigint       null,
    tx_hash         varchar(255) null,
    prev_block_hash varchar(255) null,
    constraint blocks_transactions_hash_fk
        foreign key (tx_hash) references memorial.transactions (hash)
);

