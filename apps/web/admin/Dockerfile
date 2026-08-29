FROM node:16-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate
WORKDIR /workspace/app
COPY apps/web/admin/package.json apps/web/admin/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY apps/web/admin ./
ARG REACT_APP_APP_SERVER_ENTRY=http://localhost:4033
ARG REACT_APP_RMS_ENTRY=http://localhost:4034
ENV REACT_APP_APP_SERVER_ENTRY=$REACT_APP_APP_SERVER_ENTRY
ENV REACT_APP_RMS_ENTRY=$REACT_APP_RMS_ENTRY
RUN pnpm build

FROM nginx:1.27-alpine
COPY apps/web/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/app/build /usr/share/nginx/html
EXPOSE 80
