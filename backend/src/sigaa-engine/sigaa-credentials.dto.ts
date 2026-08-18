import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SigaaCredentialsDto {
  @IsString()
  @IsNotEmpty()
  login: string;

  @IsString()
  @IsNotEmpty()
  senha: string;
}

export class SigaaLinkDto extends SigaaCredentialsDto {
  @IsBoolean()
  @IsOptional()
  rememberPassword?: boolean;
}
