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

// Configura um logger simples com cores
const logger = {
    info: (message) => console.log(`\x1b[36m[INFO] ${new Date().toISOString()} - ${message}\x1b[0m`),
    success: (message) => console.log(`\x1b[32m[SUCCESS] ${new Date().toISOString()} - ${message}\x1b[0m`),
    warn: (message) => console.log(`\x1b[33m[WARN] ${new Date().toISOString()} - ${message}\x1b[0m`),
    error: (message) => console.log(`\x1b[31m[ERROR] ${new Date().toISOString()} - ${message}\x1b[0m`),
    debug: (message) => console.log(`\x1b[35m[DEBUG] ${new Date().toISOString()} - ${message}\x1b[0m`)
};

// Configurações
const ACCESS_TOKEN = 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612';
const WEBHOOK_SECRET = '01d71aa758c6c87c2190438452b1dd6d52c06f2975fa56a221f6f324bbfa1482';
const WEBHOOK_URL = 'https://pix-backend-79lq.onrender.com/webhook';

mercadopago.configure({ access_token: ACCESS_TOKEN });
logger.info('Configuração do Mercado Pago inicializada');

// Configuração do Nodemailer com verificação
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'oficialfinanzap@gmail.com',
        pass: 'hrirzodqitdzwvrb'
    }
});

// Verifica a conexão com o serviço de e-mail
transporter.verify((error) => {
    if (error) {
        logger.error(`Falha na conexão com o serviço de e-mail: ${error.message}`);
    } else {
        logger.success('Conexão com o serviço de e-mail estabelecida com sucesso');
    }
});

const planos = {
    normal: 'instrucoesAssistenteFinanceiro.pdf',
    casal: 'instrucoesassistentefinanceiroplanocasal.pdf',
    familia: 'instrucoes_assistentefinanceiroplanofamilia.pdf'
};


// Verifica se os arquivos PDF existem
Object.entries(planos).forEach(([plano, arquivo]) => {
    const filePath = path.join(__dirname, arquivo);
    if (!fs.existsSync(filePath)) {
        logger.warn(`Arquivo PDF não encontrado para o plano ${plano}: ${filePath}`);
    } else {
        logger.debug(`Arquivo PDF encontrado para ${plano}: ${filePath}`);
    }
});

const pagamentosPendentes = {};

function verifySignature(req, secret) {
    const signature = req.headers['x-mp-signature'] || '';
    const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    return signature === hash;
}

async function enviarEmailComPDF(email, plano) {
    try {
        logger.debug(`Preparando para enviar e-mail para ${email} com plano ${plano}`);
        
        const pdfPath = path.join(__dirname, planos[plano]);
        logger.debug(`Caminho do PDF: ${pdfPath}`);

        if (!fs.existsSync(pdfPath)) {
            throw new Error(`Arquivo PDF do plano ${plano} não encontrado`);
        }

        const mailOptions = {
            from: 'oficialfinanzap@gmail.com',
            to: email,
            subject: 'Seu PDF do Finanzap',
            text: 'Obrigado por sua compra! Segue em anexo o PDF do seu plano.',
            attachments: [{
                filename: planos[plano],
                path: pdfPath
            }]
        };

        logger.debug('Configurações do e-mail:', JSON.stringify(mailOptions, null, 2));
        
        const info = await transporter.sendMail(mailOptions);
        logger.success(`E-mail enviado com sucesso para: ${email}. Message ID: ${info.messageId}`);
        
        return true;
    } catch (error) {
        logger.error(`Falha ao enviar e-mail para ${email}: ${error.message}`);
        logger.debug(`Stack trace: ${error.stack}`);
        throw error;
    }
}

app.post('/webhook', async (req, res) => {
    try {
        logger.info('Nova requisição recebida no webhook');
        
        if (!verifySignature(req, WEBHOOK_SECRET)) {
            logger.warn('Assinatura do webhook inválida');
            return res.status(401).send('Assinatura inválida');
        }

        const event = req.body;
        logger.debug(`Evento recebido: ${JSON.stringify(event, null, 2)}`);

        if (event.type === 'payment') {
            const paymentId = event.data.id;
            logger.info(`Processando pagamento: ${paymentId}`);

            try {
                const payment = await mercadopago.payment.get(paymentId);
                const paymentStatus = payment.body.status;
                const externalReference = payment.body.external_reference;
                const payerEmail = payment.body.payer.email;

                logger.debug(`Status do pagamento ${paymentId}: ${paymentStatus}`);
                logger.debug(`External Reference: ${externalReference}`);
                logger.debug(`E-mail do pagador: ${payerEmail}`);

                if (paymentStatus === 'approved') {
                    const pagamento = pagamentosPendentes[externalReference];
                    if (pagamento) {
                        logger.info(`Pagamento aprovado encontrado na lista de pendentes: ${externalReference}`);
                        logger.debug(`Dados do pagamento: ${JSON.stringify(pagamento, null, 2)}`);

                        try {
                            await enviarEmailComPDF(pagamento.email, pagamento.plano);
                            delete pagamentosPendentes[externalReference];
                            logger.success(`Processamento completo para pagamento ${paymentId}`);
                        } catch (error) {
                            logger.error(`Erro ao enviar e-mail para ${pagamento.email}: ${error.message}`);
                        }
                    } else {
                        logger.warn(`Pagamento aprovado não encontrado na lista de pendentes: ${externalReference}`);
                    }
                } else {
                    logger.debug(`Pagamento não aprovado (status: ${paymentStatus}) - nenhuma ação necessária`);
                }
            } catch (error) {
                logger.error(`Erro ao processar pagamento ${paymentId}: ${error.message}`);
            }
        }

        res.status(200).send({ status: 'sucesso', message: 'Webhook processado' });
    } catch (error) {
        logger.error(`Erro geral no webhook: ${error.message}`);
        res.status(500).send({ status: 'erro', message: 'Erro no processamento' });
    }
});

app.post('/criar-pagamento', async (req, res) => {
    try {
        logger.info('Nova requisição para criar pagamento');
        logger.debug(`Corpo da requisição: ${JSON.stringify(req.body, null, 2)}`);

        const { email, plano } = req.body;

        if (!email || !plano) {
            logger.warn('Dados incompletos na requisição de pagamento');
            return res.status(400).json({ error: 'Email e plano são obrigatórios' });
        }

        if (!planos[plano]) {
            logger.warn(`Plano inválido solicitado: ${plano}`);
            return res.status(400).json({ error: 'Plano inválido' });
        }

        const externalReference = uuidv4();
        const valor = plano === 'normal' ? 1.00 : 1;

        logger.debug(`Criando pagamento para ${email} (plano: ${plano})`);
        logger.debug(`External Reference gerado: ${externalReference}`);

        // Armazena os dados do pagamento
        pagamentosPendentes[externalReference] = { email, plano };
        logger.debug(`Pagamento armazenado em pendentes: ${JSON.stringify(pagamentosPendentes[externalReference], null, 2)}`);

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
            notification_url: WEBHOOK_URL,
            external_reference: externalReference,
            payer: { 
                email: email,
                first_name: 'Cliente',
                last_name: 'PIX',
                identification: { type: 'CPF', number: '12345678909' }
            }
        };

        logger.debug('Dados do pagamento sendo enviados ao Mercado Pago:', JSON.stringify(payment_data, null, 2));

        const response = await mercadopago.payment.create(payment_data);

        if (response.body?.id) {
            logger.success(`Pagamento criado com sucesso: ${response.body.id}`);
            logger.debug(`Resposta completa do Mercado Pago: ${JSON.stringify(response.body, null, 2)}`);

            res.json({
                paymentId: response.body.id,
                qrCode: response.body.point_of_interaction?.transaction_data?.qr_code,
                qrCodeBase64: response.body.point_of_interaction?.transaction_data?.qr_code_base64,
                status: response.body.status
            });
        } else {
            logger.error('Erro na resposta do Mercado Pago:', JSON.stringify(response.body, null, 2));
            delete pagamentosPendentes[externalReference];
            res.status(500).json({ error: 'Erro ao criar pagamento', details: response.body });
        }
    } catch (error) {
        logger.error(`Erro ao criar pagamento: ${error.message}`);
        logger.debug(`Stack trace: ${error.stack}`);
        res.status(500).json({ error: 'Erro ao criar pagamento', details: error.message });
    }
});

app.get('/status-pagamento/:paymentId', async (req, res) => {
    try {
        const { paymentId } = req.params;
        logger.info(`Verificando status do pagamento: ${paymentId}`);

        const response = await mercadopago.payment.get(paymentId);
        logger.debug(`Resposta do status do pagamento: ${JSON.stringify(response.body, null, 2)}`);

        res.json({ status: response.body.status });
    } catch (error) {
        logger.error(`Erro ao verificar status do pagamento ${paymentId}: ${error.message}`);
        res.status(500).json({ error: 'Erro ao verificar pagamento', details: error.message });
    }
});

// Rota adicional para debug
app.get('/debug/pagamentos-pendentes', (req, res) => {
    logger.debug('Listando todos os pagamentos pendentes');
    res.json(pagamentosPendentes);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.success(`Servidor rodando na porta ${PORT}`);
    logger.info('Verificando configurações iniciais...');
});
