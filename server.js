const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mercadopago = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

// Configuração avançada de logger com níveis de detalhe
const logger = {
    info: (message, metadata = {}) => 
        console.log(`\x1b[36m[INFO] ${new Date().toISOString()} - ${message}\x1b[0m`, metadata),
    
    success: (message, metadata = {}) => 
        console.log(`\x1b[32m[SUCCESS] ${new Date().toISOString()} - ${message}\x1b[0m`, metadata),
    
    warn: (message, metadata = {}) => 
        console.log(`\x1b[33m[WARN] ${new Date().toISOString()} - ${message}\x1b[0m`, metadata),
    
    error: (message, error = null, metadata = {}) => {
        console.log(`\x1b[31m[ERROR] ${new Date().toISOString()} - ${message}\x1b[0m`, metadata);
        if (error) {
            console.error(`\x1b[31m[STACK TRACE] ${error.stack}\x1b[0m`);
        }
    },
    
    debug: (message, metadata = {}) => 
        console.log(`\x1b[35m[DEBUG] ${new Date().toISOString()} - ${message}\x1b[0m`, metadata),
    
    api: (req, res, next) => {
        logger.info(`[API] ${req.method} ${req.path}`, {
            headers: req.headers,
            body: req.body,
            query: req.query,
            params: req.params
        });
        next();
    }
};

// Middleware para log de todas as requisições
app.use(logger.api);

// Configurações sensíveis (em produção, usar variáveis de ambiente)
const CONFIG = {
    ACCESS_TOKEN: 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612',
    WEBHOOK_SECRET: '01d71aa758c6c87c2190438452b1dd6d52c06f2975fa56a221f6f324bbfa1482',
    WEBHOOK_URL: 'https://pix-backend-79lq.onrender.com/webhook',
    EMAIL_CONFIG: {
        service: 'gmail',
        auth: {
            user: 'oficialfinanzap@gmail.com',
            pass: 'hrirzodqitdzwvrb'
        }
    }
};

logger.info('Iniciando configuração do servidor', { config: {
    ...CONFIG,
    EMAIL_CONFIG: { ...CONFIG.EMAIL_CONFIG, pass: '***' } // Mascarando senha do email
}});

// Inicialização do Mercado Pago
mercadopago.configure({ access_token: CONFIG.ACCESS_TOKEN });
logger.success('Mercado Pago configurado com sucesso');

// Configuração do Nodemailer com validação reforçada
const transporter = nodemailer.createTransport(CONFIG.EMAIL_CONFIG);

transporter.verify((error) => {
    if (error) {
        logger.error('Falha na conexão com o serviço de e-mail', error, {
            emailConfig: { ...CONFIG.EMAIL_CONFIG, pass: '***' }
        });
    } else {
        logger.success('Serviço de e-mail verificado com sucesso');
    }
});

// Mapeamento de planos com verificação de arquivos
const PLANOS = {
    normal: 'instrucoesAssistenteFinanceiro.pdf',
    casal: 'instrucoesassistentefinanceiroplanocasal.pdf',
    familia: 'instrucoes_assistentefinanceiroplanofamilia.pdf'
};

// Verificação de arquivos PDF
logger.info('Verificando arquivos PDF dos planos');
Object.entries(PLANOS).forEach(([plano, arquivo]) => {
    const filePath = path.join(__dirname, arquivo);
    if (!fs.existsSync(filePath)) {
        logger.warn(`Arquivo PDF não encontrado para o plano ${plano}`, { filePath });
    } else {
        logger.debug(`Arquivo PDF válido encontrado para ${plano}`, { filePath });
    }
});

// Armazenamento em memória com logs reforçados
const pagamentosPendentes = {};
logger.info('Sistema de pagamentos pendentes inicializado');

// Função utilitária para mascarar dados sensíveis
function maskData(data) {
    if (!data) return 'null';
    if (typeof data === 'string' && data.includes('@')) {
        const [name, domain] = data.split('@');
        return `${name[0]}****@${domain}`;
    }
    return data.toString().replace(/.(?=.{4})/g, '*');
}

// Validação de assinatura com logs detalhados
function verifySignature(req, secret) {
    const signature = req.headers['x-signature'] || req.headers['x-mp-signature'] || '';
    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const hash = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    logger.debug('Verificando assinatura do webhook', {
        headers: req.headers,
        receivedSignature: signature,
        computedSignature: hash,
        payloadSample: payload.substring(0, 100) + '...'
    });

    return signature === hash;
}

// Envio de e-mail com tratamento robusto de erros
async function enviarEmailComPDF(email, plano) {
    const maskedEmail = maskData(email);
    logger.info(`Iniciando envio de e-mail para ${maskedEmail}`, { plano });

    try {
        const pdfPath = path.join(__dirname, PLANOS[plano]);
        logger.debug('Caminho do PDF verificado', { pdfPath });

        if (!fs.existsSync(pdfPath)) {
            throw new Error(`Arquivo PDF do plano ${plano} não encontrado`);
        }

        const mailOptions = {
            from: CONFIG.EMAIL_CONFIG.auth.user,
            to: email,
            subject: 'Seu PDF do Finanzap',
            text: 'Obrigado por sua compra! Segue em anexo o PDF do seu plano.',
            attachments: [{
                filename: PLANOS[plano],
                path: pdfPath,
                contentType: 'application/pdf'
            }]
        };

        logger.debug('Configuração completa do e-mail', {
            mailOptions: {
                ...mailOptions,
                to: maskData(mailOptions.to),
                from: maskData(mailOptions.from)
            }
        });

        const info = await transporter.sendMail(mailOptions);
        logger.success(`E-mail enviado com sucesso para: ${maskedEmail}`, {
            messageId: info.messageId,
            envelope: info.envelope
        });

        return true;
    } catch (error) {
        logger.error(`Falha no envio para ${maskedEmail}`, error, {
            plano,
            errorDetails: {
                message: error.message,
                code: error.code
            }
        });
        throw error;
    }
}

// Webhook com validação completa
app.post('/webhook', async (req, res) => {
    const requestId = uuidv4();
    logger.info(`Nova requisição de webhook recebida (ID: ${requestId})`, {
        headers: req.headers,
        bodySample: JSON.stringify(req.body).substring(0, 200) + '...'
    });

    try {
        // Validação de assinatura
        if (!verifySignature(req, CONFIG.WEBHOOK_SECRET)) {
            logger.warn(`Assinatura inválida (ID: ${requestId})`, {
                headers: req.headers
            });
            return res.status(401).json({ 
                status: 'erro',
                message: 'Assinatura inválida',
                requestId
            });
        }

        logger.debug(`Payload completo (ID: ${requestId})`, req.body);

        // Processamento de eventos
        if (req.body.type === 'payment') {
            const paymentId = req.body.data.id;
            logger.info(`Processando pagamento (ID: ${paymentId})`, { requestId });

            try {
                const payment = await mercadopago.payment.get(paymentId);
                logger.debug(`Resposta completa do Mercado Pago (ID: ${paymentId})`, payment.body);

                const paymentStatus = payment.body.status;
                const externalReference = payment.body.external_reference;
                const payerEmail = payment.body.payer?.email || null;

                logger.info(`Status do pagamento (ID: ${paymentId})`, {
                    status: paymentStatus,
                    externalReference,
                    payerEmail: maskData(payerEmail),
                    requestId
                });

                if (paymentStatus === 'approved') {
                    const pagamento = pagamentosPendentes[externalReference];
                    
                    if (pagamento) {
                        logger.info(`Pagamento aprovado encontrado (Ref: ${externalReference})`, {
                            storedData: {
                                email: maskData(pagamento.email),
                                plano: pagamento.plano
                            },
                            requestId
                        });

                        try {
                            await enviarEmailComPDF(pagamento.email, pagamento.plano);
                            delete pagamentosPendentes[externalReference];
                            logger.success(`Processamento concluído (Ref: ${externalReference})`, {
                                requestId
                            });
                        } catch (emailError) {
                            logger.error(`Falha no envio de e-mail (Ref: ${externalReference})`, emailError, {
                                requestId
                            });
                        }
                    } else {
                        logger.warn(`Pagamento não encontrado na lista de pendentes (Ref: ${externalReference})`, {
                            requestId,
                            allPending: Object.keys(pagamentosPendentes)
                        });
                    }
                } else {
                    logger.debug(`Pagamento não aprovado (Status: ${paymentStatus})`, {
                        paymentId,
                        requestId
                    });
                }
            } catch (paymentError) {
                logger.error(`Erro ao processar pagamento (ID: ${paymentId})`, paymentError, {
                    requestId
                });
            }
        }

        res.status(200).json({ 
            status: 'sucesso',
            message: 'Webhook processado',
            requestId
        });
    } catch (error) {
        logger.error(`Erro geral no webhook (ID: ${requestId})`, error, {
            requestId
        });
        res.status(500).json({ 
            status: 'erro',
            message: 'Erro no processamento',
            requestId
        });
    }
});

// Rota de criação de pagamento com validação completa
app.post('/criar-pagamento', async (req, res) => {
    const requestId = uuidv4();
    logger.info(`Nova requisição de pagamento (ID: ${requestId})`, {
        body: {
            ...req.body,
            email: maskData(req.body.email)
        }
    });

    try {
        const { email, plano } = req.body;

        // Validações robustas
        if (!email || !plano) {
            logger.warn(`Dados incompletos (ID: ${requestId})`, {
                received: { email: maskData(email), plano }
            });
            return res.status(400).json({
                error: 'Email e plano são obrigatórios',
                requestId
            });
        }

        if (!PLANOS[plano]) {
            logger.warn(`Plano inválido (ID: ${requestId})`, {
                planoRecebido: plano,
                planosDisponiveis: Object.keys(PLANOS)
            });
            return res.status(400).json({
                error: 'Plano inválido',
                planos_disponiveis: Object.keys(PLANOS),
                requestId
            });
        }

        const externalReference = uuidv4();
        const valor = plano === 'normal' ? 1.00 : 1;

        logger.debug(`Preparando pagamento (ID: ${requestId})`, {
            email: maskData(email),
            plano,
            externalReference,
            valor
        });

        // Armazenamento com verificação
        pagamentosPendentes[externalReference] = { email, plano };
        logger.info(`Pagamento armazenado (Ref: ${externalReference})`, {
            storedData: {
                email: maskData(email),
                plano
            },
            totalPending: Object.keys(pagamentosPendentes).length,
            requestId
        });

        // Configuração do pagamento
        const payment_data = {
            statement_descriptor: 'Finanzap',
            transaction_amount: parseFloat(valor.toFixed(2)),
            description: 'Finanzap',
            additional_info: {
                items: [{
                    id: 'finanzap_001',
                    title: `Plano ${plano}`,
                    description: 'Acesso ao Assistente Financeiro',
                    category_id: 'services',
                    quantity: 1,
                    unit_price: parseFloat(valor.toFixed(2))
                }]
            },
            payment_method_id: 'pix',
            notification_url: CONFIG.WEBHOOK_URL,
            external_reference: externalReference,
            payer: { 
                email: email,
                first_name: 'Cliente',
                last_name: 'PIX',
                identification: { type: 'CPF', number: '12345678909' }
            }
        };

        logger.debug(`Dados do pagamento (ID: ${requestId})`, {
            paymentData: {
                ...payment_data,
                payer: {
                    ...payment_data.payer,
                    email: maskData(payment_data.payer.email)
                }
            }
        });

        const response = await mercadopago.payment.create(payment_data);

        if (response.body?.id) {
            logger.success(`Pagamento criado com sucesso (ID: ${response.body.id})`, {
                mercadoPagoId: response.body.id,
                status: response.body.status,
                requestId
            });

            res.json({
                paymentId: response.body.id,
                qrCode: response.body.point_of_interaction?.transaction_data?.qr_code,
                qrCodeBase64: response.body.point_of_interaction?.transaction_data?.qr_code_base64,
                status: response.body.status,
                externalReference,
                requestId
            });
        } else {
            logger.error(`Resposta inválida do Mercado Pago (ID: ${requestId})`, null, {
                fullResponse: response.body,
                requestId
            });
            
            // Limpeza em caso de falha
            delete pagamentosPendentes[externalReference];
            
            res.status(500).json({
                error: 'Erro ao criar pagamento',
                details: response.body,
                requestId
            });
        }
    } catch (error) {
        logger.error(`Erro na criação de pagamento (ID: ${requestId})`, error, {
            requestId
        });
        res.status(500).json({
            error: 'Erro ao criar pagamento',
            details: error.message,
            requestId
        });
    }
});

// Rota de status com cache e validação
app.get('/status-pagamento/:paymentId', async (req, res) => {
    const { paymentId } = req.params;
    const requestId = uuidv4();
    
    logger.info(`Verificando status do pagamento (ID: ${paymentId})`, {
        requestId
    });

    try {
        const response = await mercadopago.payment.get(paymentId);
        
        logger.debug(`Resposta completa do status (ID: ${paymentId})`, {
            status: response.body.status,
            externalReference: response.body.external_reference,
            payerEmail: maskData(response.body.payer?.email),
            requestId
        });

        res.json({ 
            status: response.body.status,
            requestId
        });
    } catch (error) {
        logger.error(`Erro ao verificar status (ID: ${paymentId})`, error, {
            requestId
        });
        res.status(500).json({
            error: 'Erro ao verificar pagamento',
            details: error.message,
            requestId
        });
    }
});

// Rotas de debug e monitoramento
app.get('/debug/pagamentos-pendentes', (req, res) => {
    const maskedPayments = Object.entries(pagamentosPendentes).reduce((acc, [key, value]) => {
        acc[key] = {
            ...value,
            email: maskData(value.email)
        };
        return acc;
    }, {});

    logger.debug('Listando pagamentos pendentes (com dados mascarados)', {
        count: Object.keys(pagamentosPendentes).length,
        sample: maskedPayments
    });

    res.json({
        count: Object.keys(pagamentosPendentes).length,
        payments: maskedPayments
    });
});

// Health Check
app.get('/health', (req, res) => {
    const healthcheck = {
        uptime: process.uptime(),
        message: 'OK',
        timestamp: Date.now(),
        checks: {
            mercadopago: true,
            email: transporter ? true : false,
            pdfs: Object.keys(PLANOS).map(plano => ({
                plano,
                exists: fs.existsSync(path.join(__dirname, PLANOS[plano]))
            }))
        }
    };
    
    logger.info('Health check realizado', healthcheck);
    res.json(healthcheck);
});

// Tratamento de erros global
app.use((err, req, res, next) => {
    const errorId = uuidv4();
    logger.error(`Erro não tratado (ID: ${errorId})`, err, {
        path: req.path,
        method: req.method
    });
    
    res.status(500).json({
        error: 'Erro interno no servidor',
        errorId
    });
});

// Inicialização do servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.success(`Servidor rodando na porta ${PORT}`, {
        environment: process.env.NODE_ENV || 'development',
        pid: process.pid
    });
});
